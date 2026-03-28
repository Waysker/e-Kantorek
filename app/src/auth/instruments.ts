export const ORAGH_INSTRUMENT_OPTIONS = [
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
  "Gitara",
  "Bas",
  "Tuba",
] as const;

export type OraghInstrument = (typeof ORAGH_INSTRUMENT_OPTIONS)[number];
