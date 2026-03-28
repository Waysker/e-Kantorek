import type { EventsRepository, UsersRepository } from "./contracts";
import type { EventDetail, EventListItem, UserProfile } from "../domain/models";
import { forumSnapshot } from "./generated/forumSnapshot";
import type { ForumSnapshotShape } from "./snapshotShape";

export class ForumSnapshotRepository implements EventsRepository, UsersRepository {
  private readonly snapshot: ForumSnapshotShape;

  constructor(snapshot: ForumSnapshotShape = forumSnapshot) {
    this.snapshot = snapshot;
  }

  async getCurrentUser(): Promise<UserProfile> {
    return this.snapshot.currentUser;
  }

  async listEvents(): Promise<EventListItem[]> {
    return this.snapshot.events;
  }

  async getEventDetail(eventId: string): Promise<EventDetail> {
    const event = this.snapshot.eventDetailsById[eventId];

    if (!event) {
      throw new Error(`Snapshot event ${eventId} could not be found.`);
    }

    return event;
  }

  getSnapshotGeneratedAt(): string | null {
    return this.snapshot.metadata?.generatedAt ?? null;
  }
}
