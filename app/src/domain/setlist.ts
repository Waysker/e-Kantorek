import type { EventSetlist } from "./models";

// The forum sync puts a single "Pending" placeholder section in when the
// thread has no setlist post yet.
export function isPlaceholderSetlist(setlist: EventSetlist): boolean {
  const items = setlist.sections.flatMap((section) => section.items);
  return (
    items.length === 0 ||
    (setlist.sections.length === 1 && setlist.sections[0].title === "Pending" && items.length === 1)
  );
}

// Forum posts sometimes leave list punctuation in front of a title (". Daft Punk").
export function cleanSetlistLabel(label: string): string {
  const cleaned = label.replace(/^[\s.,;:)\-–—]+/, "").trim();
  return cleaned.length > 0 ? cleaned : label;
}
