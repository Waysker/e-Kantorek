import type { FeedRepository } from "../contracts";
import type { FeedPost } from "../../domain/models";

const feedFixtures: FeedPost[] = [
  {
    id: "feed-1",
    authorName: "Zarzad ORAGH",
    kindLabel: "Announcement",
    title: "This week at a glance",
    body:
      "Thursday rehearsal starts at 18:00, and Friday is the last day to report transport needs for the X Hall concert.",
    commentCount: 6,
    createdAt: "2026-03-26T08:30:00+01:00",
    isPinned: true,
  },
  {
    id: "feed-2",
    authorName: "Natalia B.",
    kindLabel: "Social",
    title: "Afterparty sketch",
    body:
      "If the weather holds, we can move the post-concert meetup outside instead of booking the basement room.",
    commentCount: 11,
    createdAt: "2026-03-25T19:45:00+01:00",
    isPinned: false,
  },
  {
    id: "feed-3",
    authorName: "Sekcja Wyjazdowa",
    kindLabel: "Trip",
    title: "Workshop bus timing",
    body:
      "Please check the provisional departure board. This stays fixture-backed for now and will later move to the real backend.",
    commentCount: 3,
    createdAt: "2026-03-24T10:10:00+01:00",
    isPinned: false,
  },
];

export class StaticFeedRepository implements FeedRepository {
  async listFeedPosts(): Promise<FeedPost[]> {
    return feedFixtures;
  }
}
