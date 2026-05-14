const UNKNOWN_INSTRUMENT_LABEL = "Instrument not mapped yet";
const CANONICAL_INSTRUMENT_OPTIONS = [
  "Flety",
  "Oboje",
  "Klarnety",
  "Saksofony",
  "Fagoty",
  "Waltornie",
  "Trąbki",
  "Eufonia",
  "Puzony",
  "Perkusja",
  "Gitary",
  "Tuby",
] as const;

const CANONICAL_INSTRUMENT_LABEL_BY_KEY: Record<string, string> = {
  flet: "Flety",
  flety: "Flety",
  oboj: "Oboje",
  oboje: "Oboje",
  klarnet: "Klarnety",
  klarnety: "Klarnety",
  fagot: "Fagoty",
  fagoty: "Fagoty",
  saksofon: "Saksofony",
  saksofony: "Saksofony",
  waltornia: "Waltornie",
  waltornie: "Waltornie",
  trabka: "Trąbki",
  trabki: "Trąbki",
  puzon: "Puzony",
  puzony: "Puzony",
  tuba: "Tuby",
  tuby: "Tuby",
  eufonia: "Eufonia",
  eufonie: "Eufonia",
  perkusja: "Perkusja",
  gitara: "Gitary",
  gitary: "Gitary",
  bas: "Gitary",
  basy: "Gitary",
};

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeInstrumentKey(value: unknown): string {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function canonicalizeInstrumentLabel(
  value: unknown,
  fallbackLabel = UNKNOWN_INSTRUMENT_LABEL,
): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return fallbackLabel;
  }

  return CANONICAL_INSTRUMENT_LABEL_BY_KEY[normalizeInstrumentKey(normalized)] ?? normalized;
}

export { CANONICAL_INSTRUMENT_OPTIONS, UNKNOWN_INSTRUMENT_LABEL };
