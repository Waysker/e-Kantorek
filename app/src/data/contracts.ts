import type {
  EventDetail,
  EventListItem,
  FeedPost,
  UserProfile,
} from "../domain/models";

export interface FeedRepository {
  listFeedPosts(): Promise<FeedPost[]>;
}

export interface EventsRepository {
  listEvents(): Promise<EventListItem[]>;
  getEventDetail(eventId: string): Promise<EventDetail>;
}

export interface UsersRepository {
  getCurrentUser(): Promise<UserProfile>;
}
