import type { PrimaryRole } from "./models";

export const PRIMARY_ROLE_SEQUENCE: PrimaryRole[] = [
  "member",
  "section",
  "board",
  "admin",
];

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRoleKey(value: unknown): string {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizePrimaryRole(value: unknown): PrimaryRole {
  const normalized = normalizeRoleKey(value);

  if (normalized === "admin") {
    return "admin";
  }

  if (
    normalized === "section" ||
    normalized === "leader" ||
    normalized === "lider" ||
    normalized === "sekcyjne" ||
    normalized === "sekcyjny" ||
    normalized === "sekcyjna" ||
    normalized === "sekcyjni" ||
    normalized === "section leader"
  ) {
    return "section";
  }

  if (
    normalized === "board" ||
    normalized === "zarzad"
  ) {
    return "board";
  }

  return "member";
}

export function canWriteAttendanceByRole(role: PrimaryRole): boolean {
  return role === "board" || role === "admin";
}

export function canViewAttendanceSummaryByRole(role: PrimaryRole): boolean {
  return role === "section" || role === "board" || role === "admin";
}

export function canManageRolesByRole(role: PrimaryRole): boolean {
  return role === "admin";
}
