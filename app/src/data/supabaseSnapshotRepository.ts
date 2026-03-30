import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { EventDetail, EventListItem, UserProfile } from "../domain/models";
import type { EventsRepository, UsersRepository } from "./contracts";
import { ForumSnapshotRepository } from "./snapshotRepository";
import type { ForumSnapshotShape } from "./snapshotShape";

type SnapshotRow = {
  snapshot_key: string;
  payload: ForumSnapshotShape;
};

type SupabaseSnapshotRepositoryOptions = {
  url?: string;
  anonKey?: string;
  client?: SupabaseClient;
  snapshotKey?: string;
};

export class SupabaseSnapshotRepository implements EventsRepository, UsersRepository {
  private readonly client: SupabaseClient;
  private readonly snapshotKey: string;
  private readonly fallbackRepository: ForumSnapshotRepository;
  private cachedSnapshot: ForumSnapshotShape | null = null;
  private resolvedSourceLabel: "supabase_cloud" | "local_fallback" | null = null;

  constructor({
    url,
    anonKey,
    client,
    snapshotKey = "forum",
  }: SupabaseSnapshotRepositoryOptions) {
    if (client) {
      this.client = client;
    } else {
      if (!url || !anonKey) {
        throw new Error(
          "SupabaseSnapshotRepository requires either an existing client or url+anonKey.",
        );
      }
      this.client = createClient(url, anonKey, {
        auth: { persistSession: false },
      });
    }
    this.snapshotKey = snapshotKey;
    this.fallbackRepository = new ForumSnapshotRepository();
  }

  async getCurrentUser(): Promise<UserProfile> {
    const snapshot = await this.loadSnapshot();
    return snapshot.currentUser;
  }

  async listEvents(): Promise<EventListItem[]> {
    const snapshot = await this.loadSnapshot();
    return snapshot.events;
  }

  async getEventDetail(eventId: string): Promise<EventDetail> {
    const snapshot = await this.loadSnapshot();
    const event = snapshot.eventDetailsById[eventId];
    if (!event) {
      throw new Error(`Cloud snapshot event ${eventId} could not be found.`);
    }
    return event;
  }

  getResolvedSourceLabel(): "supabase_cloud" | "local_fallback" | null {
    return this.resolvedSourceLabel;
  }

  getSnapshotGeneratedAt(): string | null {
    return this.cachedSnapshot?.metadata?.generatedAt ?? null;
  }

  private async loadSnapshot(): Promise<ForumSnapshotShape> {
    if (this.cachedSnapshot) {
      return this.cachedSnapshot;
    }

    try {
      const { data, error } = await this.client
        .from("forum_snapshot_cache")
        .select("snapshot_key,payload")
        .eq("snapshot_key", this.snapshotKey)
        .maybeSingle<SnapshotRow>();

      if (error) {
        throw error;
      }

      if (!data?.payload) {
        throw new Error(`Snapshot key ${this.snapshotKey} was not found.`);
      }

      this.cachedSnapshot = data.payload;
      this.resolvedSourceLabel = "supabase_cloud";
      return data.payload;
    } catch {
      const [currentUser, events] = await Promise.all([
        this.fallbackRepository.getCurrentUser(),
        this.fallbackRepository.listEvents(),
      ]);
      const details = await Promise.all(
        events.map((event) => this.fallbackRepository.getEventDetail(event.id)),
      );
      const fallbackSnapshot: ForumSnapshotShape = {
        metadata: {
          generatedAt: new Date().toISOString(),
          source: "fallback:local-snapshot",
        },
        currentUser,
        events,
        eventDetailsById: Object.fromEntries(
          details.map((event) => [event.id, event]),
        ),
      };
      this.cachedSnapshot = fallbackSnapshot;
      this.resolvedSourceLabel = "local_fallback";
      return fallbackSnapshot;
    }
  }
}
