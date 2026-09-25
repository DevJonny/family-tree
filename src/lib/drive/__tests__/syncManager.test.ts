import assert from "node:assert/strict";
import { test } from "node:test";
import { hasConflict, remoteChangedSinceLastSync } from "../syncManager";
import type { DriveFileRef } from "../types";

const base: DriveFileRef = { fileId: "f1", name: "tree.ged", modifiedTime: "2026-01-01T00:00:00Z", md5Checksum: "abc" };

test("no prior sync means no conflict possible yet", () => {
  assert.equal(remoteChangedSinceLastSync(undefined, base), false);
});

test("same checksum means remote has not changed", () => {
  const remote = { ...base };
  assert.equal(remoteChangedSinceLastSync(base, remote), false);
});

test("different checksum means remote has changed", () => {
  const remote = { ...base, md5Checksum: "different" };
  assert.equal(remoteChangedSinceLastSync(base, remote), true);
});

test("falls back to modifiedTime when checksums are unavailable", () => {
  const lastSynced: DriveFileRef = { fileId: "f1", name: "tree.ged", modifiedTime: "2026-01-01T00:00:00Z" };
  const remote: DriveFileRef = { fileId: "f1", name: "tree.ged", modifiedTime: "2026-01-02T00:00:00Z" };
  assert.equal(remoteChangedSinceLastSync(lastSynced, remote), true);
});

test("hasConflict is false when there are no unsynced local edits, even if remote changed", () => {
  const remote = { ...base, md5Checksum: "different" };
  assert.equal(hasConflict(base, remote, false), false);
});

test("hasConflict is true only when both local edits exist and remote changed", () => {
  const remote = { ...base, md5Checksum: "different" };
  assert.equal(hasConflict(base, remote, true), true);
  assert.equal(hasConflict(base, base, true), false);
});
