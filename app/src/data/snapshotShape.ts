import type { EventDetail, EventListItem, UserProfile } from "../domain/models";

export type ForumSnapshotShape = {
  metadata: {
    generatedAt: string;
    source: string;
  };
  currentUser: UserProfile;
  events: EventListItem[];
  eventDetailsById: Record<string, EventDetail>;
};

