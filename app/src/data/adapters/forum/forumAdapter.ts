import type { EventsRepository, UsersRepository } from "../../contracts";
import type {
  AttendanceStatus,
  EventComment,
  EventDetail,
  EventListItem,
  EventSetlist,
  EventUpdate,
  SquadComposition,
  SquadMember,
  UserProfile,
} from "../../../domain/models";
import { canonicalizeInstrumentLabel } from "../../../domain/instruments";
import {
  legacyForumAttendance,
  legacyForumCurrentUserId,
  legacyForumEvents,
  legacyForumMembers,
  type LegacyForumEventRow,
  type LegacyForumMessageRow,
  type LegacyForumReplyCode,
} from "./legacyForumFixtures";

const UNKNOWN_INSTRUMENT_LABEL = "Unassigned";

function normalizeForumInstrument(value: string | undefined): string {
  return canonicalizeInstrumentLabel(value, UNKNOWN_INSTRUMENT_LABEL);
}

function mapReplyCode(code: LegacyForumReplyCode): AttendanceStatus {
  switch (code) {
    case "yes":
      return "going";
    case "maybe":
      return "maybe";
    case "no":
      return "not_going";
    default:
      return "no_response";
  }
}

function mapAttendanceLabel(status: AttendanceStatus) {
  switch (status) {
    case "going":
      return "Going";
    case "maybe":
      return "Maybe";
    case "not_going":
      return "Not going";
    default:
      return "No response";
  }
}

function parseSetlist(eventId: string, setlistPlain?: string): EventSetlist {
  const fallbackSource = `PROGRAM\n1. Setlist not published yet`;
  const source = setlistPlain?.trim() || fallbackSource;
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sections: EventSetlist["sections"] = [];
  let currentSection = {
    id: `${eventId}-section-1`,
    title: "Program",
    items: [] as EventSetlist["sections"][number]["items"],
  };
  let sectionIndex = 1;
  let itemIndex = 1;

  function pushCurrentSection() {
    if (currentSection.items.length === 0) {
      return;
    }

    sections.push(currentSection);
  }

  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.*)$/);

    if (!match) {
      pushCurrentSection();
      sectionIndex += 1;
      currentSection = {
        id: `${eventId}-section-${sectionIndex}`,
        title: line.replace(/:$/, ""),
        items: [],
      };
      itemIndex = 1;
      continue;
    }

    const value = match[1];
    const [label, detail] = value.split(/\s+-\s+/, 2);
    currentSection.items.push({
      id: `${eventId}-item-${itemIndex}`,
      label,
      detail,
    });
    itemIndex += 1;
  }

  pushCurrentSection();

  const itemCount = sections.reduce(
    (count, section) => count + section.items.length,
    0,
  );

  return {
    eventId,
    preview: lines.slice(0, 4).join(" • "),
    modeHint: itemCount > 5 ? "scroll" : "fit",
    sections,
  };
}

function mapMessage(message: LegacyForumMessageRow): EventUpdate | EventComment {
  const author = legacyForumMembers.find(
    (member) => member.member_id === message.author_member_id,
  );

  return {
    id: message.post_id,
    authorName: author?.full_name ?? "Unknown member",
    createdAt: message.created_at,
    body: message.body_plain,
  };
}

function buildSquad(eventId: string): SquadComposition {
  const relevantAttendance = legacyForumAttendance.filter(
    (row) => row.topic_id === eventId,
  );

  const instrumentOrder = Array.from(
    new Set(
      legacyForumMembers.map((member) => normalizeForumInstrument(member.instrument_label)),
    ),
  );

  return {
    eventId,
    groups: instrumentOrder.map((instrument) => {
      const confirmedMembers: SquadMember[] = [];
      const maybeMembers: SquadMember[] = [];

      for (const member of legacyForumMembers) {
        const memberInstrument = normalizeForumInstrument(member.instrument_label);

        if (memberInstrument !== instrument) {
          continue;
        }

        const reply = relevantAttendance.find(
          (attendance) => attendance.member_id === member.member_id,
        );
        const attendanceStatus = reply ? mapReplyCode(reply.reply_code) : "no_response";

        if (attendanceStatus === "going") {
          confirmedMembers.push({
            id: member.member_id,
            fullName: member.full_name,
          });
        }

        if (attendanceStatus === "maybe") {
          maybeMembers.push({
            id: member.member_id,
            fullName: member.full_name,
          });
        }
      }

      return {
        instrument,
        confirmedMembers,
        maybeMembers,
      };
    }),
  };
}

function buildAttendanceSummary(eventId: string) {
  const relevantAttendance = legacyForumAttendance.filter(
    (row) => row.topic_id === eventId,
  );

  let going = 0;
  let maybe = 0;
  let notGoing = 0;

  for (const response of relevantAttendance) {
    const status = mapReplyCode(response.reply_code);

    if (status === "going") {
      going += 1;
    } else if (status === "maybe") {
      maybe += 1;
    } else if (status === "not_going") {
      notGoing += 1;
    }
  }

  const totalMembers = legacyForumMembers.length;
  const currentUserReply = relevantAttendance.find(
    (row) => row.member_id === legacyForumCurrentUserId,
  );
  const userStatus = currentUserReply
    ? mapReplyCode(currentUserReply.reply_code)
    : "no_response";

  return {
    going,
    maybe,
    notGoing,
    noResponse: Math.max(totalMembers - relevantAttendance.length, 0),
    userStatus,
    userStatusLabel: mapAttendanceLabel(userStatus),
  };
}

function buildAttendanceGroups(eventId: string) {
  const relevantAttendance = legacyForumAttendance.filter(
    (row) => row.topic_id === eventId,
  );
  const statuses = [
    { status: "going", label: "Going" },
    { status: "maybe", label: "Maybe" },
    { status: "not_going", label: "Not going" },
  ] as const;

  return statuses.map((group) => {
    const participants = relevantAttendance
      .filter((row) => mapReplyCode(row.reply_code) === group.status)
      .map((row) => {
        const member = legacyForumMembers.find(
          (candidate) => candidate.member_id === row.member_id,
        );

        return {
          id: row.member_id,
          fullName: member?.full_name ?? "Unknown member",
          ...(member?.instrument_label
            ? { primaryInstrument: normalizeForumInstrument(member.instrument_label) }
            : {}),
        };
      });

    return {
      status: group.status,
      label: group.label,
      count: participants.length,
      participants,
    };
  });
}

function mapEventPreview(event: LegacyForumEventRow): EventListItem {
  const attendanceSummary = buildAttendanceSummary(event.topic_id);

  return {
    id: event.topic_id,
    title: event.topic_title,
    startsAt: event.starts_at,
    venue: event.venue_line,
    preview: event.topic_body_plain,
    attendanceStatus: attendanceSummary.userStatus,
    attendanceLabel: attendanceSummary.userStatusLabel,
    updateCount: event.official_posts.length,
    commentCount: event.member_posts.length,
  };
}

function mapEventDetail(event: LegacyForumEventRow): EventDetail {
  const listItem = mapEventPreview(event);

  return {
    ...listItem,
    description: event.topic_body_plain,
    updates: event.official_posts.map((message) => mapMessage(message) as EventUpdate),
    comments: event.member_posts.map((message) => mapMessage(message) as EventComment),
    attendanceSummary: buildAttendanceSummary(event.topic_id),
    attendanceGroups: buildAttendanceGroups(event.topic_id),
    setlist: parseSetlist(event.topic_id, event.setlist_plain),
    squad: buildSquad(event.topic_id),
  };
}

export class ForumAdapter implements UsersRepository, EventsRepository {
  async getCurrentUser(): Promise<UserProfile> {
    const member = legacyForumMembers.find(
      (candidate) => candidate.member_id === legacyForumCurrentUserId,
    );

    if (!member) {
      throw new Error("Current forum member could not be resolved.");
    }

    return {
      id: member.member_id,
      fullName: member.full_name,
      role: member.role_code,
      primaryInstrument: normalizeForumInstrument(member.instrument_label),
    };
  }

  async listEvents(): Promise<EventListItem[]> {
    return legacyForumEvents.map(mapEventPreview);
  }

  async getEventDetail(eventId: string): Promise<EventDetail> {
    const event = legacyForumEvents.find((candidate) => candidate.topic_id === eventId);

    if (!event) {
      throw new Error(`Forum event ${eventId} could not be found.`);
    }

    return mapEventDetail(event);
  }
}
