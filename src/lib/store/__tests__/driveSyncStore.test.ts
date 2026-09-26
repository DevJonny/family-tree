import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import { DriveAuthError } from "../../drive/driveClient";
import type { DriveFileRef } from "../../drive/types";
import { buildFamilyTree } from "../../gedcom/model";
import { createDriveSyncStore, type DriveApi } from "../driveSyncStore";
import { useFamilyTreeStore } from "../familyTreeStore";

/**
 * The Drive sync state machine (connect, auto-sync, conflicts, sign-in
 * expiry, the file picker) against an in-memory Drive. The real network
 * calls are covered by drive/__tests__/driveClient.test.ts.
 */

const HOUR = 3_600_000;
const tree = useFamilyTreeStore.getState;

/** An in-memory Drive folder, with hooks to act as "another device" and to hold uploads mid-flight. */
function fakeDrive() {
  let clock = 1_000_000;
  let tokenCount = 0;
  let fileCount = 0;
  let revoked = false;
  const files = new Map<string, { name: string; content: string; modifiedTime: string }>();
  const log: string[] = [];
  let held: Array<() => void> | null = null;

  const tick = () => new Date((clock += 1000)).toISOString();
  const ref = (fileId: string): DriveFileRef => {
    const f = files.get(fileId);
    if (!f) throw new Error(`no file ${fileId}`);
    return {
      fileId,
      name: f.name,
      modifiedTime: f.modifiedTime,
      md5Checksum: createHash("md5").update(f.content).digest("hex"),
    };
  };
  const auth = (token: string) => {
    if (revoked || !token.startsWith("tok")) throw new DriveAuthError("Drive sign-in expired");
  };

  const api: DriveApi = {
    requestAccessToken: async () => {
      log.push("sign-in");
      revoked = false;
      return { value: `tok${++tokenCount}`, expiresAt: clock + HOUR };
    },
    ensureAppFolder: async (token) => (auth(token), "folder"),
    listGedcomFiles: async (token) => (auth(token), [...files.keys()].map(ref)),
    downloadFileContent: async (token, fileId) => {
      auth(token);
      log.push(`download ${fileId}`);
      return files.get(fileId)!.content;
    },
    createGedcomFile: async (token, _folder, name, content) => {
      auth(token);
      const id = `file${++fileCount}`;
      files.set(id, { name, content, modifiedTime: tick() });
      log.push(`create ${id}`);
      return ref(id);
    },
    updateGedcomFile: async (token, fileId, content) => {
      auth(token);
      if (held) await new Promise<void>((release) => held!.push(release));
      files.set(fileId, { ...files.get(fileId)!, content, modifiedTime: tick() });
      log.push(`upload ${fileId}`);
      return ref(fileId);
    },
    getFileMetadata: async (token, fileId) => (auth(token), ref(fileId)),
  };

  return {
    api,
    files,
    log,
    now: () => clock,
    advance: (ms: number) => void (clock += ms),
    /** Another device (or the Drive web UI) writes a file. */
    put: (fileId: string, name: string, content: string) => {
      files.set(fileId, { name, content, modifiedTime: tick() });
    },
    /** Drive starts rejecting the current token (401). */
    revoke: () => void (revoked = true),
    /** Uploads wait until `release()`; returns it. */
    holdUploads: () => {
      held = [];
      return () => {
        const waiting = held ?? [];
        held = null;
        waiting.forEach((release) => release());
      };
    },
    heldUploads: () => held?.length ?? 0,
  };
}

function setup({ remembered }: { remembered?: DriveFileRef } = {}) {
  const drive = fakeDrive();
  const kvMap = new Map<string, unknown>();
  if (remembered) kvMap.set("family-tree:drive-file-ref", remembered);
  const kv = { get: async (k: string) => kvMap.get(k), set: async (k: string, v: unknown) => void kvMap.set(k, v) };
  const store = createDriveSyncStore({ drive: drive.api, kv, now: drive.now, debounceMs: 5 });
  current = store;
  return { drive, kvMap, store, sync: store.getState };
}

let current: ReturnType<typeof createDriveSyncStore> | null = null;
afterEach(() => {
  current?.getState().disconnect(); // stops watching the (shared) family-tree store
  current = null;
  tree().loadTree(buildFamilyTree([]));
});

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const text = (...records: string[]) => ["0 HEAD", "1 CHAR UTF-8", ...records, "0 TRLR", ""].join("\r\n");
const ADA = text("0 @I1@ INDI", "1 NAME Ada /Lovelace/");
const BYRON = text("0 @I1@ INDI", "1 NAME George /Byron/");
const people = () => Object.values(tree().tree.individuals).map((i) => i.names[0]?.given);

// --- Connecting ------------------------------------------------------------

test("connecting to an empty folder uploads the open tree as a new file", async () => {
  tree().addIndividual({ given: "Ada" });
  const { drive, sync, kvMap } = setup();
  await sync().connect();

  assert.equal(sync().status, "idle");
  assert.equal(sync().fileRef?.name, "family-tree.ged");
  assert.match(drive.files.get("file1")!.content, /1 NAME Ada/);
  assert.deepEqual(kvMap.get("family-tree:drive-file-ref"), sync().fileRef, "remembered for next time");
  assert.equal(tree().dirty, false, "the open tree is now saved on Drive");
});

test("connecting with nothing open loads the folder's only file", async () => {
  const { drive, sync } = setup();
  drive.put("f1", "tree.ged", ADA);
  await sync().connect();

  assert.equal(sync().status, "idle");
  assert.deepEqual(people(), ["Ada"]);
  assert.equal(tree().fileName, "tree.ged");
});

test("connecting with a different tree open asks, and 'keep mine' uploads the tree as it is then", async () => {
  tree().addIndividual({ given: "Grace" });
  const { drive, sync } = setup();
  drive.put("f1", "tree.ged", ADA);
  await sync().connect();

  assert.equal(sync().status, "conflict");
  assert.equal(sync().conflict?.reason, "connect");
  assert.deepEqual(people(), ["Grace"], "nothing replaced yet");

  tree().addIndividual({ given: "Alan" }); // while the banner is up
  await settle();
  assert.ok(!drive.log.some((l) => l.startsWith("upload")), "nothing uploads while the banner is up");

  await sync().resolveConflict("local");
  assert.equal(sync().status, "idle");
  assert.match(drive.files.get("f1")!.content, /Grace[\s\S]*Alan/);
  assert.equal(tree().dirty, false);
});

test("connecting with a different tree open and choosing Drive's loads it", async () => {
  tree().addIndividual({ given: "Grace" });
  const { drive, sync } = setup();
  drive.put("f1", "tree.ged", ADA);
  await sync().connect();
  await sync().resolveConflict("remote");

  assert.equal(sync().status, "idle");
  assert.deepEqual(people(), ["Ada"]);
});

test("reconnecting uses the file this browser used before, even when another is newer", async () => {
  const { drive, sync } = setup({ remembered: { fileId: "old", name: "old.ged", modifiedTime: "x" } });
  drive.put("old", "old.ged", ADA);
  drive.put("new", "new.ged", BYRON);
  await sync().connect();
  assert.equal(sync().fileRef?.fileId, "old");
  assert.deepEqual(people(), ["Ada"]);
});

// --- Which file? ------------------------------------------------------------

test("with several files and none remembered, connecting asks which one, newest first", async () => {
  const { drive, sync } = setup();
  drive.put("a", "older.ged", ADA);
  drive.put("b", "newer.ged", BYRON);
  await sync().connect();

  assert.equal(sync().status, "choosing-file");
  assert.deepEqual(
    sync().fileChoices?.map((f) => f.name),
    ["newer.ged", "older.ged"],
  );
  assert.ok(!drive.log.some((l) => l.startsWith("download")), "nothing loaded until the user picks");
  assert.deepEqual(people(), []);
});

test("picking a file connects to it like any other", async () => {
  const { drive, sync, kvMap } = setup();
  drive.put("a", "older.ged", ADA);
  drive.put("b", "newer.ged", BYRON);
  await sync().connect();
  await sync().pickFile("a");

  assert.equal(sync().status, "idle");
  assert.equal(sync().fileChoices, null);
  assert.equal(sync().fileRef?.fileId, "a");
  assert.deepEqual(people(), ["Ada"]);
  assert.equal((kvMap.get("family-tree:drive-file-ref") as DriveFileRef).fileId, "a");

  tree().addIndividual({ given: "Charles" });
  await settle();
  assert.match(drive.files.get("a")!.content, /Charles/, "edits sync to the picked file");
  assert.doesNotMatch(drive.files.get("b")!.content, /Charles/);
});

test("picking a file still asks before replacing a different open tree", async () => {
  tree().addIndividual({ given: "Grace" });
  const { drive, sync } = setup();
  drive.put("a", "older.ged", ADA);
  drive.put("b", "newer.ged", BYRON);
  await sync().connect();
  await sync().pickFile("b");
  assert.equal(sync().status, "conflict");
  assert.deepEqual(people(), ["Grace"]);
});

test("cancelling the picker leaves sync off and the open tree alone", async () => {
  tree().addIndividual({ given: "Grace" });
  const { drive, sync } = setup();
  drive.put("a", "older.ged", ADA);
  drive.put("b", "newer.ged", BYRON);
  await sync().connect();
  sync().disconnect();

  assert.equal(sync().status, "signed-out");
  assert.equal(sync().fileChoices, null);
  tree().addIndividual({ given: "Alan" });
  await settle();
  assert.ok(!drive.log.some((l) => l.startsWith("upload")));
  assert.deepEqual(people(), ["Grace", "Alan"]);
});

test("picking after the sign-in has lapsed signs in again first", async () => {
  const { drive, sync } = setup();
  drive.put("a", "older.ged", ADA);
  drive.put("b", "newer.ged", BYRON);
  await sync().connect();
  drive.advance(2 * HOUR);
  await sync().pickFile("a");
  assert.equal(sync().status, "idle");
  assert.equal(drive.log.filter((l) => l === "sign-in").length, 2);
});

// --- Syncing ----------------------------------------------------------------

async function connected(content = ADA) {
  const ctx = setup();
  ctx.drive.put("f1", "tree.ged", content);
  await ctx.sync().connect();
  assert.equal(ctx.sync().status, "idle");
  return ctx;
}

test("an edit is uploaded after the debounce and marks the tree saved", async () => {
  const { drive, sync } = await connected();
  tree().addIndividual({ given: "Charles" });
  assert.equal(tree().dirty, true);
  await settle();
  assert.match(drive.files.get("f1")!.content, /Charles/);
  assert.equal(tree().dirty, false);
  assert.equal(sync().status, "idle");
});

test("a change made on another device since the last sync is a conflict, not overwritten", async () => {
  const { drive, sync } = await connected();
  drive.put("f1", "tree.ged", BYRON);
  tree().addIndividual({ given: "Charles" });
  await settle();

  assert.equal(sync().status, "conflict");
  assert.equal(sync().conflict?.reason, "remote-changed");
  assert.match(drive.files.get("f1")!.content, /Byron/, "Drive's version is untouched");
  assert.equal(tree().dirty, true);
});

test("a sync requested mid-upload waits, instead of mistaking this tab's own write for a conflict", async () => {
  const { drive, sync } = await connected();
  const release = drive.holdUploads();
  tree().addIndividual({ given: "Charles" });
  await settle();
  assert.equal(drive.heldUploads(), 1, "first upload in flight");

  tree().addIndividual({ given: "Mary" });
  await settle();
  assert.equal(drive.heldUploads(), 1, "no second upload alongside it");

  release();
  await settle();
  assert.equal(sync().status, "idle", "no false conflict");
  assert.match(drive.files.get("f1")!.content, /Charles[\s\S]*Mary/);
  assert.equal(tree().dirty, false);
});

test("edits made during an upload stay unsaved until they go up too", async () => {
  const { drive } = await connected();
  const release = drive.holdUploads();
  tree().addIndividual({ given: "Charles" });
  await settle();
  tree().addIndividual({ given: "Mary" });
  release();
  await settle(2);
  // The first upload (Charles only) is done; Mary is waiting for the next one.
  assert.doesNotMatch(drive.files.get("f1")!.content, /Mary/);
  assert.equal(tree().dirty, true);
  await settle();
  assert.equal(tree().dirty, false);
});

test("disconnecting mid-upload doesn't bring the connection back when it lands", async () => {
  const { drive, sync } = await connected();
  const release = drive.holdUploads();
  tree().addIndividual({ given: "Charles" });
  await settle();
  sync().disconnect();
  release();
  await settle();
  assert.equal(sync().status, "signed-out");
  assert.equal(sync().fileRef, null);
});

// --- Sign-in expiry ---------------------------------------------------------

test("an expired sign-in stops sync with edits kept, and 'Sign in again' pushes them without reloading", async () => {
  const { drive, sync } = await connected();
  drive.advance(HOUR); // within a minute of expiry counts as expired
  tree().addIndividual({ given: "Charles" });
  await settle();

  assert.equal(sync().status, "needs-auth");
  assert.deepEqual(people(), ["Ada", "Charles"], "edits kept");
  const downloads = drive.log.filter((l) => l.startsWith("download")).length;

  await sync().resume();
  assert.equal(sync().status, "idle");
  assert.match(drive.files.get("f1")!.content, /Charles/);
  assert.equal(drive.log.filter((l) => l.startsWith("download")).length, downloads, "resume never re-downloads");
});

test("Drive rejecting the token (401) is also needs-auth, not an error", async () => {
  const { drive, sync } = await connected();
  drive.revoke();
  tree().addIndividual({ given: "Charles" });
  await settle();
  assert.equal(sync().status, "needs-auth");

  await sync().resume();
  assert.equal(sync().status, "idle");
  assert.match(drive.files.get("f1")!.content, /Charles/);
});
