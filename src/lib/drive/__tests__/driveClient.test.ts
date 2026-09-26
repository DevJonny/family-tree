import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  DriveAuthError,
  createGedcomFile,
  downloadFileContent,
  ensureAppFolder,
  getFileMetadata,
  listGedcomFiles,
  requestAccessToken,
  updateGedcomFile,
} from "../driveClient";

/**
 * The Drive REST calls against a stubbed `fetch`: what each one sends, how
 * it reads the answer, and how failures are classified (a 401 must become
 * a DriveAuthError so sync asks the user to sign in again instead of
 * erroring).
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { window?: unknown }).window;
});

/** Stubs fetch with one queued response per call, recording what was sent. */
function stubFetch(...responses: Array<{ status?: number; json?: unknown; text?: string }>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      headers: { ...(init.headers as Record<string, string>) },
      body: init.body === undefined ? undefined : String(init.body),
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${String(input)}`);
    const body = next.json !== undefined ? JSON.stringify(next.json) : (next.text ?? "");
    return new Response(body, { status: next.status ?? 200 });
  }) as typeof fetch;
  return calls;
}

const apiFile = { id: "f1", name: "family-tree.ged", modifiedTime: "2026-09-01T10:00:00Z", md5Checksum: "abc" };
const fileRef = { fileId: "f1", name: "family-tree.ged", modifiedTime: "2026-09-01T10:00:00Z", md5Checksum: "abc" };

test("every call sends the access token", async () => {
  const calls = stubFetch({ text: "0 HEAD" });
  await downloadFileContent("tok", "f1");
  assert.equal(calls[0].headers.Authorization, "Bearer tok");
});

test("ensureAppFolder reuses the existing folder", async () => {
  const calls = stubFetch({ json: { files: [{ id: "folder1", name: "Family Tree App" }] } });
  assert.equal(await ensureAppFolder("tok"), "folder1");
  assert.equal(calls.length, 1);
  const q = decodeURIComponent(new URL(calls[0].url).searchParams.get("q")!);
  assert.match(q, /name='Family Tree App'/);
  assert.match(q, /mimeType='application\/vnd.google-apps.folder'/);
  assert.match(q, /trashed=false/);
});

test("ensureAppFolder creates the folder when there isn't one", async () => {
  const calls = stubFetch({ json: { files: [] } }, { json: { id: "new-folder" } });
  assert.equal(await ensureAppFolder("tok"), "new-folder");
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(JSON.parse(calls[1].body!), { name: "Family Tree App", mimeType: "application/vnd.google-apps.folder" });
});

test("listGedcomFiles lists the folder's files as DriveFileRefs", async () => {
  const calls = stubFetch({ json: { files: [apiFile, { id: "f2", name: "old.ged", modifiedTime: "2025-01-01T00:00:00Z" }] } });
  const files = await listGedcomFiles("tok", "folder1");
  assert.deepEqual(files, [fileRef, { fileId: "f2", name: "old.ged", modifiedTime: "2025-01-01T00:00:00Z", md5Checksum: undefined }]);
  const q = decodeURIComponent(new URL(calls[0].url).searchParams.get("q")!);
  assert.equal(q, "'folder1' in parents and trashed=false");
});

test("downloadFileContent reads the file's content, not its metadata", async () => {
  const calls = stubFetch({ text: "0 HEAD\r\n0 TRLR\r\n" });
  assert.equal(await downloadFileContent("tok", "f1"), "0 HEAD\r\n0 TRLR\r\n");
  assert.match(calls[0].url, /\/files\/f1\?alt=media$/);
});

test("createGedcomFile uploads metadata and content in one multipart request, into the folder", async () => {
  const calls = stubFetch({ json: apiFile });
  assert.deepEqual(await createGedcomFile("tok", "folder1", "family-tree.ged", "0 HEAD\r\n0 TRLR\r\n"), fileRef);
  const { url, method, headers, body } = calls[0];
  assert.equal(method, "POST");
  assert.match(url, /^https:\/\/www.googleapis.com\/upload\/drive\/v3\/files\?uploadType=multipart/);
  const boundary = /boundary=(.+)$/.exec(headers["Content-Type"])![1];
  // Each part: CRLF, headers, blank line, content; the CRLF before the next boundary belongs to the delimiter.
  const content = (part: string) => part.slice(part.indexOf("\r\n\r\n") + 4, -2);
  const parts = body!.split(`--${boundary}`);
  assert.deepEqual(JSON.parse(content(parts[1])), {
    name: "family-tree.ged",
    parents: ["folder1"],
    mimeType: "text/plain",
  });
  assert.equal(content(parts[2]), "0 HEAD\r\n0 TRLR\r\n", "the file content, byte for byte");
  assert.equal(parts[3], "--");
});

test("updateGedcomFile replaces the content in place and returns the new checksum", async () => {
  const calls = stubFetch({ json: { ...apiFile, md5Checksum: "def" } });
  const updated = await updateGedcomFile("tok", "f1", "new text");
  assert.equal(updated.md5Checksum, "def");
  assert.equal(calls[0].method, "PATCH");
  assert.match(calls[0].url, /\/upload\/drive\/v3\/files\/f1\?uploadType=media/);
  assert.equal(calls[0].body, "new text");
});

test("getFileMetadata asks for the fields conflict detection needs", async () => {
  const calls = stubFetch({ json: apiFile });
  assert.deepEqual(await getFileMetadata("tok", "f1"), fileRef);
  assert.match(calls[0].url, /fields=id,name,modifiedTime,md5Checksum/);
});

test("a 401 from any call is a DriveAuthError, so sync asks to sign in again", async () => {
  for (const call of [
    () => getFileMetadata("tok", "f1"),
    () => updateGedcomFile("tok", "f1", "x"),
    () => createGedcomFile("tok", "folder1", "a.ged", "x"),
  ]) {
    stubFetch({ status: 401, text: "Invalid Credentials" });
    await assert.rejects(call(), DriveAuthError);
  }
});

test("other failures are plain errors that say what failed", async () => {
  stubFetch({ status: 500, text: "backend down" });
  await assert.rejects(downloadFileContent("tok", "f1"), (err: Error) => {
    assert.ok(!(err instanceof DriveAuthError));
    assert.match(err.message, /500 backend down/);
    return true;
  });
});

// --- Sign-in (GIS token client) ------------------------------------------------

type TokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (response: { access_token: string; expires_in?: number | string; error?: string }) => void;
  error_callback?: (error: { type: "popup_failed_to_open" | "popup_closed" | "unknown" }) => void;
};

/** A fake GIS that answers each token request with `answer`. */
function stubGis(answer: (config: TokenClientConfig) => void): TokenClientConfig[] {
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "client-123";
  const configs: TokenClientConfig[] = [];
  (globalThis as { window?: unknown }).window = {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: TokenClientConfig) => {
            configs.push(config);
            return { requestAccessToken: () => answer(config) };
          },
        },
      },
    },
  };
  return configs;
}

test("requestAccessToken asks for the drive.file scope only and returns the token with its expiry", async () => {
  const configs = stubGis((c) => c.callback({ access_token: "tok", expires_in: "3599" }));
  const before = Date.now();
  const token = await requestAccessToken();
  assert.equal(token.value, "tok");
  assert.ok(token.expiresAt >= before + 3_599_000);
  assert.equal(configs[0].client_id, "client-123");
  assert.equal(configs[0].scope, "https://www.googleapis.com/auth/drive.file");
});

test("a refused, closed or blocked sign-in is a DriveAuthError, never a hang", async () => {
  stubGis((c) => c.callback({ access_token: "", error: "access_denied" }));
  await assert.rejects(requestAccessToken(), DriveAuthError);

  stubGis((c) => c.error_callback!({ type: "popup_closed" }));
  await assert.rejects(requestAccessToken(), /closed before it finished/);

  stubGis((c) => c.error_callback!({ type: "popup_failed_to_open" }));
  await assert.rejects(requestAccessToken(), /popup was blocked/);
});
