import assert from "node:assert/strict";
import test from "node:test";

import { mergeOverrides } from "./overrides-merge.mjs";

test("keeps entries that only exist in the database (panel-added)", () => {
  const existing = { byUid: { 888: "Oboje" }, byFullName: { "Jan Nowak": "Trąbki" }, byUsername: {} };
  const incoming = { byUid: {}, byFullName: { "Ala Flet": "Flety" }, byUsername: {} };
  const { merged, summary } = mergeOverrides(existing, incoming);

  assert.deepEqual(merged.byUid, { 888: "Oboje" });
  assert.deepEqual(merged.byFullName, { "Jan Nowak": "Trąbki", "Ala Flet": "Flety" });
  assert.deepEqual(summary, { kept: 2, added: 1, changed: 0 });
});

test("incoming wins on conflicts and counts as changed", () => {
  const { merged, summary } = mergeOverrides(
    { byUid: { 10: "Flety", 11: "Tuby" } },
    { byUid: { 10: "Oboje", 11: "Tuby" } },
  );

  assert.deepEqual(merged.byUid, { 10: "Oboje", 11: "Tuby" });
  assert.deepEqual(summary, { kept: 0, added: 0, changed: 1 });
});

test("tolerates missing or malformed payloads", () => {
  const { merged, summary } = mergeOverrides(null, { byUid: { 1: "Flety" }, byFullName: [] });

  assert.deepEqual(merged, { byUid: { 1: "Flety" }, byFullName: {}, byUsername: {} });
  assert.deepEqual(summary, { kept: 0, added: 1, changed: 0 });
});

test("does not mutate its inputs", () => {
  const existing = { byUid: { 1: "Flety" } };
  const incoming = { byUid: { 2: "Tuby" } };
  mergeOverrides(existing, incoming);

  assert.deepEqual(existing, { byUid: { 1: "Flety" } });
  assert.deepEqual(incoming, { byUid: { 2: "Tuby" } });
});
