import type {
  EventsRepository,
  FeedRepository,
  UsersRepository,
} from "./contracts";
import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import { StaticFeedRepository } from "./fixtures/feedFixtures";
import { ForumSnapshotRepository } from "./snapshotRepository";
import { SupabaseSnapshotRepository } from "./supabaseSnapshotRepository";

type DataSourceStatus = {
  label: string;
  generatedAt: string | null;
};

type EventRepositorySelection = {
  repository: EventsRepository & UsersRepository;
  getDataSourceStatus: () => DataSourceStatus;
};

function createEventRepository(): EventRepositorySelection {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const supabaseClientKey =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (supabaseUrl && supabaseClientKey) {
    const repository = new SupabaseSnapshotRepository({
      client: supabaseAuthClient ?? undefined,
      url: supabaseUrl,
      anonKey: supabaseClientKey,
    });
    return {
      repository,
      getDataSourceStatus: () => {
        const resolved = repository.getResolvedSourceLabel();
        const generatedAt = repository.getSnapshotGeneratedAt();

        if (resolved === "supabase_cloud") {
          return { label: "Supabase cloud", generatedAt };
        }
        if (resolved === "local_fallback") {
          return { label: "Local fallback", generatedAt };
        }
        return { label: "Supabase cloud (pending)", generatedAt };
      },
    };
  }

  const repository = new ForumSnapshotRepository();
  return {
    repository,
    getDataSourceStatus: () => ({
      label: "Local snapshot",
      generatedAt: repository.getSnapshotGeneratedAt(),
    }),
  };
}

export function createPrototypeRepositories(): {
  feed: FeedRepository;
  events: EventsRepository;
  users: UsersRepository;
  getDataSourceStatus: () => DataSourceStatus;
} {
  const selection = createEventRepository();

  return {
    feed: new StaticFeedRepository(),
    events: selection.repository,
    users: selection.repository,
    getDataSourceStatus: selection.getDataSourceStatus,
  };
}
