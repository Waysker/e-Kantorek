type LegacyForumMemberRow = {
  member_id: string;
  full_name: string;
  role_code: "member" | "section" | "board" | "admin" | "leader";
  instrument_label?: string;
};

type LegacyForumReplyCode = "yes" | "maybe" | "no";

type LegacyForumAttendanceRow = {
  topic_id: string;
  member_id: string;
  reply_code: LegacyForumReplyCode;
};

type LegacyForumMessageRow = {
  post_id: string;
  author_member_id: string;
  created_at: string;
  body_plain: string;
};

type LegacyForumEventRow = {
  topic_id: string;
  topic_title: string;
  venue_line?: string;
  starts_at: string;
  topic_body_plain: string;
  official_posts: LegacyForumMessageRow[];
  member_posts: LegacyForumMessageRow[];
  setlist_plain?: string;
};

export const legacyForumCurrentUserId = "member-lead";

export const legacyForumMembers: LegacyForumMemberRow[] = [
  {
    member_id: "member-lead",
    full_name: "Lead Member",
    role_code: "section",
    instrument_label: "Trąbki",
  },
  {
    member_id: "member-a",
    full_name: "Member A",
    role_code: "member",
    instrument_label: "Trąbki",
  },
  {
    member_id: "member-admin",
    full_name: "Admin Member",
    role_code: "admin",
    instrument_label: "Klarnety",
  },
  {
    member_id: "member-b",
    full_name: "Member B",
    role_code: "member",
    instrument_label: "Flety",
  },
  {
    member_id: "member-c",
    full_name: "Member C",
    role_code: "member",
    instrument_label: "Puzony",
  },
  {
    member_id: "member-d",
    full_name: "Member D",
    role_code: "member",
    instrument_label: "Klarnety",
  },
];

export const legacyForumEvents: LegacyForumEventRow[] = [
  {
    topic_id: "event-x-hall",
    topic_title: "20 Mar 2026 Concert at X Hall",
    venue_line: "X Hall, Krakow",
    starts_at: "2026-03-20T18:00:00+01:00",
    topic_body_plain:
      "Arrival at 16:30. Concert blacks. Please confirm transport needs and keep the final section order ready for stage setup.",
    official_posts: [
      {
        post_id: "event-x-hall-update-1",
        author_member_id: "member-admin",
        created_at: "2026-03-18T09:30:00+01:00",
        body_plain:
          "Bus departs from AGH at 15:30. Scores will be ready on stands. Please keep cases labeled for the return load-out.",
      },
      {
        post_id: "event-x-hall-update-2",
        author_member_id: "member-lead",
        created_at: "2026-03-19T20:15:00+01:00",
        body_plain:
          "Trumpets and clarinets should be ready for a short balance check immediately after arrival.",
      },
    ],
    member_posts: [
      {
        post_id: "event-x-hall-comment-1",
        author_member_id: "member-a",
        created_at: "2026-03-19T21:05:00+01:00",
        body_plain:
          "Can someone share whether the backstage room has space for extra garment bags?",
      },
      {
        post_id: "event-x-hall-comment-2",
        author_member_id: "member-b",
        created_at: "2026-03-20T08:40:00+01:00",
        body_plain: "Flutes are traveling directly, so we will meet at the venue.",
      },
    ],
    setlist_plain: `MAIN PROGRAM
1. Fanfara AGH
2. Marsz Orkiestrowy - short version
3. Highland Cathedral
4. Taniec Galicyjski

ENCORE
1. Hej, bystra woda`,
  },
  {
    topic_id: "event-barborka",
    topic_title: "4 Dec 2026 Barborka",
    venue_line: "Aula AGH",
    starts_at: "2026-12-04T19:00:00+01:00",
    topic_body_plain:
      "Ceremonial concert with short speech order before music block. Uniform details will be confirmed closer to the date.",
    official_posts: [
      {
        post_id: "event-barborka-update-1",
        author_member_id: "member-admin",
        created_at: "2026-11-29T12:00:00+01:00",
        body_plain:
          "Please keep the full evening free. A final technical schedule will be posted next week.",
      },
    ],
    member_posts: [
      {
        post_id: "event-barborka-comment-1",
        author_member_id: "member-d",
        created_at: "2026-11-30T14:25:00+01:00",
        body_plain: "Will there be a separate warm-up room for woodwinds this year?",
      },
    ],
    setlist_plain: `CEREMONY
1. Hymn AGH
2. Uroczysty Marsz

CONCERT
1. Polonez Reprezentacyjny
2. Finale Jubileuszowe`,
  },
];

export const legacyForumAttendance: LegacyForumAttendanceRow[] = [
  { topic_id: "event-x-hall", member_id: "member-lead", reply_code: "yes" },
  { topic_id: "event-x-hall", member_id: "member-a", reply_code: "yes" },
  { topic_id: "event-x-hall", member_id: "member-admin", reply_code: "yes" },
  { topic_id: "event-x-hall", member_id: "member-b", reply_code: "no" },
  { topic_id: "event-x-hall", member_id: "member-c", reply_code: "maybe" },
  { topic_id: "event-x-hall", member_id: "member-d", reply_code: "yes" },
  { topic_id: "event-barborka", member_id: "member-lead", reply_code: "maybe" },
  { topic_id: "event-barborka", member_id: "member-a", reply_code: "yes" },
  { topic_id: "event-barborka", member_id: "member-admin", reply_code: "yes" },
  { topic_id: "event-barborka", member_id: "member-b", reply_code: "yes" },
];

export type {
  LegacyForumAttendanceRow,
  LegacyForumEventRow,
  LegacyForumMemberRow,
  LegacyForumMessageRow,
  LegacyForumReplyCode,
};
