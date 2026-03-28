import type { EventDetail, EventListItem, UserProfile } from "../../domain/models";

export const forumSnapshot: {
  metadata: {
    generatedAt: string;
    source: string;
  };
  currentUser: UserProfile;
  events: EventListItem[];
  eventDetailsById: Record<string, EventDetail>;
} = {
  metadata: {
    generatedAt: "2026-03-28T00:00:00.000Z",
    source: "sanitized-template",
  },
  currentUser: {
    id: "local-user-template",
    fullName: "ORAGH Member",
    role: "member",
  },
  events: [
    {
      id: "sample-event-1",
      title: "Sample Event",
      startsAt: "2026-05-01T19:00:00+02:00",
      venue: "Sample Venue",
      preview: "This is a sanitized local fallback event used only when Supabase data is unavailable.",
      attendanceStatus: "no_response",
      attendanceLabel: "No response",
      updateCount: 0,
      commentCount: 0,
    },
  ],
  eventDetailsById: {
    "sample-event-1": {
      id: "sample-event-1",
      title: "Sample Event",
      startsAt: "2026-05-01T19:00:00+02:00",
      venue: "Sample Venue",
      preview: "This is a sanitized local fallback event used only when Supabase data is unavailable.",
      attendanceStatus: "no_response",
      attendanceLabel: "No response",
      updateCount: 0,
      commentCount: 0,
      description:
        "Sanitized placeholder content. Real forum-derived content is kept outside the repository and published to Supabase.",
      updates: [],
      comments: [],
      attendanceSummary: {
        going: 0,
        maybe: 0,
        notGoing: 0,
        noResponse: 0,
        userStatus: "no_response",
        userStatusLabel: "No response",
      },
      attendanceGroups: [],
      setlist: {
        eventId: "sample-event-1",
        preview: "Setlist not posted yet.",
        modeHint: "fit",
        sections: [
          {
            id: "sample-event-1-setlist-section-1",
            title: "Program",
            items: [{ id: "sample-event-1-setlist-item-1", label: "Setlist not posted yet." }],
          },
        ],
      },
      squad: {
        eventId: "sample-event-1",
        groups: [],
      },
    },
  },
};
