const BUCKETS = ["byUid", "byFullName", "byUsername"];

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Merge two override payloads bucket by bucket. Entries only present in
 * `existing` are kept (e.g. ones added through the board panel); on conflicts
 * the `incoming` value wins. Returns the merged payload and a change summary.
 */
export function mergeOverrides(existing, incoming) {
  const merged = {};
  const summary = { kept: 0, added: 0, changed: 0 };

  for (const bucket of BUCKETS) {
    const current = toObject(toObject(existing)[bucket]);
    const next = toObject(toObject(incoming)[bucket]);
    merged[bucket] = { ...current };

    for (const [key, value] of Object.entries(next)) {
      if (!(key in current)) {
        summary.added += 1;
      } else if (current[key] !== value) {
        summary.changed += 1;
      }
      merged[bucket][key] = value;
    }

    summary.kept += Object.keys(current).filter((key) => !(key in next)).length;
  }

  return { merged, summary };
}
