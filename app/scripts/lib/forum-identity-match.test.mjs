// Suggestion of the forum person behind an app account (src/domain/forumIdentity.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nameKey, parseForumIdentity, suggestForumPerson } from "../../src/domain/forumIdentity.ts";

const person = (forumUid, fullName, instrument, taken = false) => ({ forumUid, fullName, instrument, taken });

const PEOPLE = [
  person("619", "Katarzyna Rech", "Saksofony"),
  person("701", "Kacper Rutkowski", "Trąbki"),
  person("700", "Anna Łęcka", "Flety"),
  person("702", "Jakub Nowak", "Puzony"),
  person("703", "Jan Nowak", "Puzony"),
  person("704", "Zofia Wójcik", "Klarnety", true),
];

describe("suggestForumPerson", () => {
  it("matches a diminutive in the same section", () => {
    assert.equal(suggestForumPerson("Kasia Rech", "Saksofony", PEOPLE)?.forumUid, "619");
    assert.equal(suggestForumPerson("Kuba Nowak", "Puzony", PEOPLE)?.forumUid, "702");
  });

  it("matches one typo and missing diacritics", () => {
    assert.equal(suggestForumPerson("Anna Lecka", "Flety", PEOPLE)?.forumUid, "700");
    assert.equal(suggestForumPerson("Katarzyna Rehc", "Saksofony", PEOPLE)?.forumUid, "619");
  });

  it("does not take a different first name with the same surname", () => {
    assert.equal(suggestForumPerson("Tytus Rutkowski", "Trąbki", PEOPLE), null);
  });

  it("does not cross sections or take linked people", () => {
    assert.equal(suggestForumPerson("Kasia Rech", "Flety", PEOPLE), null);
    assert.equal(suggestForumPerson("Zosia Wójcik", "Klarnety", PEOPLE), null);
  });

  it("gives up when two people fit", () => {
    const twins = [...PEOPLE, person("705", "Katarzyna Rech", "Saksofony")];
    assert.equal(suggestForumPerson("Kasia Rech", "Saksofony", twins), null);
  });
});

describe("helpers", () => {
  it("folds Polish letters", () => {
    assert.equal(nameKey("  Łucja  Żółć "), "lucja zolc");
  });

  it("parses the RPC row", () => {
    assert.deepEqual(parseForumIdentity([]), { kind: "unlinked" });
    assert.deepEqual(parseForumIdentity([{ no_forum_account: true, status: "proposed" }]), {
      kind: "no_forum_account",
      status: "proposed",
    });
    assert.deepEqual(
      parseForumIdentity([{ forum_uid: "619", forum_full_name: "Katarzyna Rech", status: "verified", no_forum_account: false }]),
      { kind: "linked", forumUid: "619", forumFullName: "Katarzyna Rech", status: "verified" },
    );
  });
});
