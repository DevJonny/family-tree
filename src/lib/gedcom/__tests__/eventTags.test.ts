import assert from "node:assert/strict";
import { test } from "node:test";
import { FAMILY_EVENT_TAGS, INDIVIDUAL_EVENT_TAGS, labelForEventTag } from "../eventTags";

test("the family event picker offers the standard family events except marriage, which has its own block", () => {
  const tags = FAMILY_EVENT_TAGS.map((e) => e.tag);
  for (const tag of ["ANUL", "CENS", "DIV", "DIVF", "ENGA", "MARB", "MARC", "MARL", "MARS", "RESI", "EVEN"]) {
    assert.ok(tags.includes(tag), `${tag} missing`);
  }
  assert.ok(!tags.includes("MARR"));
  assert.ok(!tags.includes("BIRT"));
});

test("every family and individual event tag has a readable label", () => {
  for (const { tag, label } of [...FAMILY_EVENT_TAGS, ...INDIVIDUAL_EVENT_TAGS]) {
    assert.equal(labelForEventTag(tag), label);
    assert.notEqual(label, tag);
  }
  assert.equal(labelForEventTag("MARR"), "Marriage");
  assert.equal(labelForEventTag("DIVF"), "Divorce filed");
  assert.equal(labelForEventTag("MARL"), "Marriage license");
});

test("an unknown tag is labelled with the tag itself", () => {
  assert.equal(labelForEventTag("_MILT"), "_MILT");
});
