import assert from "node:assert/strict";
import { test } from "node:test";
import { loadGedcom, saveGedcom } from "../../gedcom";
import { hasConflict, isEmptyTree, planConnect, remoteChangedSinceLastSync } from "../syncManager";
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

test("connecting with nothing open just loads the Drive file", () => {
  const empty = loadGedcom("0 HEAD\n1 CHAR UTF-8\n0 TRLR\n").tree;
  assert.equal(isEmptyTree(empty), true);
  assert.equal(planConnect(empty, "whatever is on Drive"), "load-remote");
});

test("connecting with the same tree open as on Drive needs no question", () => {
  const { tree } = loadGedcom("0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Ann /Lee/\n0 TRLR\n");
  assert.equal(planConnect(tree, saveGedcom(tree)), "in-sync");
});

test("connecting with a different tree open asks which to keep, instead of replacing it", () => {
  const { tree } = loadGedcom("0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Ann /Lee/\n0 TRLR\n");
  assert.equal(isEmptyTree(tree), false);
  assert.equal(planConnect(tree, saveGedcom(tree).replace("Ann", "Anne")), "ask");
});

test("any record at all counts as work worth asking about, not just people", () => {
  for (const record of ["0 @F1@ FAM", "0 @S1@ SOUR", "0 @R1@ REPO", "0 @N1@ NOTE Hi", "0 @U1@ SUBM"]) {
    const { tree } = loadGedcom(`0 HEAD\n1 CHAR UTF-8\n${record}\n0 TRLR\n`);
    assert.equal(isEmptyTree(tree), false, record);
  }
});
