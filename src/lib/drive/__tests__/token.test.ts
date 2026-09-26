import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPIRY_MARGIN_MS, tokenFromResponse, usableToken } from "../token";

const now = 1_000_000;

test("a token is usable until shortly before it expires", () => {
  const token = { value: "t", expiresAt: now + 10 * 60_000 };
  assert.equal(usableToken(token, now), "t");
  assert.equal(usableToken(token, token.expiresAt - EXPIRY_MARGIN_MS - 1), "t");
  assert.equal(usableToken(token, token.expiresAt - EXPIRY_MARGIN_MS), null, "renew before Drive starts rejecting it");
  assert.equal(usableToken(token, token.expiresAt + 1), null);
});

test("no token is never usable", () => {
  assert.equal(usableToken(null, now), null);
});

test("tokenFromResponse turns GIS's expires_in (seconds, sometimes a string) into an absolute time", () => {
  assert.deepEqual(tokenFromResponse({ access_token: "t", expires_in: 3599 }, now), { value: "t", expiresAt: now + 3_599_000 });
  assert.deepEqual(tokenFromResponse({ access_token: "t", expires_in: "3599" }, now), { value: "t", expiresAt: now + 3_599_000 });
});

test("a response without a usable expires_in assumes GIS's usual hour", () => {
  assert.deepEqual(tokenFromResponse({ access_token: "t" }, now), { value: "t", expiresAt: now + 3_600_000 });
  assert.deepEqual(tokenFromResponse({ access_token: "t", expires_in: "soon" }, now), { value: "t", expiresAt: now + 3_600_000 });
});
