import { CANONICAL_INSTRUMENT_OPTIONS } from "../domain/instruments";

export const ORAGH_INSTRUMENT_OPTIONS = CANONICAL_INSTRUMENT_OPTIONS;

export type OraghInstrument = (typeof ORAGH_INSTRUMENT_OPTIONS)[number];
