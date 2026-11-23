import { UNKNOWN_INSTRUMENT_LABEL } from "./instruments";
import type { EventDetail, SquadMember } from "./models";

/**
 * Forum members who show up in a squad but have no instrument mapping yet
 * (they land in the "Instrument not mapped yet" group). Deduplicated by member id.
 */
export function findUnmappedSquadMembers(
  eventDetailsById: Record<string, EventDetail>,
): SquadMember[] {
  const byId = new Map<string, SquadMember>();

  for (const detail of Object.values(eventDetailsById)) {
    for (const group of detail.squad?.groups ?? []) {
      if (group.instrument !== UNKNOWN_INSTRUMENT_LABEL) {
        continue;
      }
      for (const member of [...group.confirmedMembers, ...group.maybeMembers]) {
        if (!byId.has(member.id)) {
          byId.set(member.id, member);
        }
      }
    }
  }

  return [...byId.values()].sort((left, right) =>
    left.fullName.localeCompare(right.fullName, "pl"),
  );
}

export function canSeeUnmappedMembersAlertByRole(role: string): boolean {
  return role === "board" || role === "admin";
}
