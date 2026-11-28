// Linking an app account to one person on the forum (migration 033).
// Declarations come from forum polls keyed by forum uid, so the app matches the
// signed-in member by that uid, not by the name typed at registration.

export type ForumIdentityLinkStatus = "proposed" | "verified";

export type ForumIdentity =
  // The RPC is missing (migration not applied yet): match by name, as before.
  | { kind: "unavailable" }
  | { kind: "unlinked" }
  | { kind: "no_forum_account"; status: ForumIdentityLinkStatus }
  | { kind: "linked"; forumUid: string; forumFullName: string; status: ForumIdentityLinkStatus };

export type ForumPerson = {
  forumUid: string;
  fullName: string;
  instrument: string | null;
  taken: boolean;
};

export function forumParticipantId(forumUid: string): string {
  return `forum-user-${forumUid}`;
}

type RawRow = Record<string, unknown>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function parseForumIdentity(rows: unknown): ForumIdentity {
  const row = Array.isArray(rows) ? (rows[0] as RawRow | undefined) : undefined;
  if (!row) {
    return { kind: "unlinked" };
  }
  const status: ForumIdentityLinkStatus = row.status === "verified" ? "verified" : "proposed";
  if (row.no_forum_account === true) {
    return { kind: "no_forum_account", status };
  }
  const forumUid = text(row.forum_uid);
  if (!forumUid) {
    return { kind: "unlinked" };
  }
  return { kind: "linked", forumUid, forumFullName: text(row.forum_full_name), status };
}

export function parseForumPeople(rows: unknown): ForumPerson[] {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => row as RawRow)
    .map((row) => ({
      forumUid: text(row.forum_uid),
      fullName: text(row.full_name),
      instrument: text(row.instrument) || null,
      taken: row.taken === true,
    }))
    .filter((person) => person.forumUid && person.fullName);
}

// Lower case, no diacritics, single spaces ("Łęcka" → "lecka").
export function nameKey(value: string): string {
  return value
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = nameKey(fullName).split(" ").filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

// Common Polish diminutives → full first name (keys and values as nameKey gives them).
const DIMINUTIVES: Record<string, string[]> = {
  kasia: ["katarzyna"],
  kaska: ["katarzyna"],
  basia: ["barbara"],
  ola: ["aleksandra"],
  ala: ["alicja", "alina"],
  ania: ["anna"],
  asia: ["joanna"],
  gosia: ["malgorzata"],
  magda: ["magdalena"],
  madzia: ["magdalena"],
  zosia: ["zofia"],
  zuzia: ["zuzanna"],
  ewka: ["ewa"],
  iza: ["izabela"],
  ula: ["urszula"],
  kuba: ["jakub"],
  bartek: ["bartlomiej", "bartosz"],
  tomek: ["tomasz"],
  wojtek: ["wojciech"],
  maciek: ["maciej"],
  piotrek: ["piotr"],
  jasiek: ["jan"],
  janek: ["jan"],
  staszek: ["stanislaw"],
  krzysiek: ["krzysztof"],
  grzesiek: ["grzegorz"],
  szymek: ["szymon"],
  kacperek: ["kacper"],
  antek: ["antoni"],
  franek: ["franciszek"],
  olek: ["aleksander"],
  adas: ["adam"],
  marcinek: ["marcin"],
  wiktorka: ["wiktoria"],
  natka: ["natalia"],
  karolcia: ["karolina"],
  julka: ["julia"],
};

// Damerau–Levenshtein distance of at most one (one typo or swapped pair).
function withinOneEdit(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  const lengthGap = Math.abs(left.length - right.length);
  if (lengthGap > 1) {
    return false;
  }
  if (left.length === right.length) {
    const diffs: number[] = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        diffs.push(index);
        if (diffs.length > 2) {
          return false;
        }
      }
    }
    if (diffs.length === 1) {
      return true;
    }
    const [first, second] = diffs;
    return second === first + 1 && left[first] === right[second] && left[second] === right[first];
  }
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  for (let index = 0; index < longer.length; index += 1) {
    if (longer.slice(0, index) + longer.slice(index + 1) === shorter) {
      return true;
    }
  }
  return false;
}

function firstNamesMatch(typed: string, onForum: string): boolean {
  if (!typed || !onForum) {
    return false;
  }
  if (withinOneEdit(typed, onForum)) {
    return true;
  }
  const forms = DIMINUTIVES[typed] ?? [];
  const reverse = DIMINUTIVES[onForum] ?? [];
  return forms.includes(onForum) || reverse.includes(typed);
}

// The one forum person who is probably the member: same surname (or one typo),
// same section if both are known, first name equal, a diminutive or one typo away.
// Two or more fits → null: the member picks from the list instead.
export function suggestForumPerson(
  profileFullName: string,
  profileInstrument: string | null,
  people: ForumPerson[],
): ForumPerson | null {
  const typed = splitName(profileFullName);
  if (!typed.last) {
    return null;
  }
  const fits = people.filter((person) => {
    if (person.taken) {
      return false;
    }
    if (profileInstrument && person.instrument && person.instrument !== profileInstrument) {
      return false;
    }
    const onForum = splitName(person.fullName);
    return withinOneEdit(typed.last, onForum.last) && firstNamesMatch(typed.first, onForum.first);
  });
  return fits.length === 1 ? fits[0] : null;
}

function surnameKey(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

export function compareBySurname(left: ForumPerson, right: ForumPerson): number {
  return (
    surnameKey(left.fullName).localeCompare(surnameKey(right.fullName), "pl") ||
    left.fullName.localeCompare(right.fullName, "pl")
  );
}
