import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { supabaseAuthClient } from "../../auth/supabaseAuthClient";
import { tr } from "../../i18n";
import type { AttendanceEntryRow, ForumSnapshotPayload, MemberRow, SessionRow } from "./types";

type UseAttendanceBootDataParams = {
  client: typeof supabaseAuthClient;
  setErrorMessage: (message: string | null) => void;
  normalizeSessions: (sessions: SessionRow[]) => SessionRow[];
  chooseDefaultSession: (sessions: SessionRow[]) => SessionRow | null;
  onDefaultSession: (session: SessionRow) => void;
};

type UseAttendanceBootDataResult = {
  sessions: SessionRow[];
  members: MemberRow[];
  snapshotPayload: ForumSnapshotPayload | null;
  isBootLoading: boolean;
  setSessions: Dispatch<SetStateAction<SessionRow[]>>;
};

export function useAttendanceBootData({
  client,
  setErrorMessage,
  normalizeSessions,
  chooseDefaultSession,
  onDefaultSession,
}: UseAttendanceBootDataParams): UseAttendanceBootDataResult {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [snapshotPayload, setSnapshotPayload] = useState<ForumSnapshotPayload | null>(null);
  const [isBootLoading, setIsBootLoading] = useState(true);
  const bootLoadRequestIdRef = useRef(0);
  const snapshotLoadRequestIdRef = useRef(0);

  useEffect(() => {
    let isDisposed = false;
    const requestId = bootLoadRequestIdRef.current + 1;
    bootLoadRequestIdRef.current = requestId;

    async function loadBootData() {
      if (!client) {
        setErrorMessage(tr("Brak konfiguracji Supabase.", "Supabase is not configured."));
        setIsBootLoading(false);
        return;
      }

      setIsBootLoading(true);
      setErrorMessage(null);
      try {
        const [sessionsResult, membersResult] = await Promise.all([
          client
            .from("events")
            .select("event_id,title,event_date,source_header,source_column")
            .order("event_date", { ascending: false })
            .limit(500),
          client
            .from("members")
            .select("member_id,full_name,instrument,is_active")
            .eq("is_active", true)
            .order("instrument", { ascending: true })
            .order("full_name", { ascending: true }),
        ]);

        if (isDisposed || requestId !== bootLoadRequestIdRef.current) {
          return;
        }

        if (sessionsResult.error) {
          throw new Error(sessionsResult.error.message);
        }
        if (membersResult.error) {
          throw new Error(membersResult.error.message);
        }

        const loadedSessionsRaw = (sessionsResult.data ?? []) as SessionRow[];
        const loadedSessions = normalizeSessions(loadedSessionsRaw);
        const loadedMembers = (membersResult.data ?? []) as MemberRow[];
        setSessions(loadedSessions);
        setMembers(loadedMembers);

        if (loadedSessions.length > 0) {
          const defaultSession = chooseDefaultSession(loadedSessions);
          if (defaultSession) {
            onDefaultSession(defaultSession);
          }
        }
      } catch (error) {
        if (isDisposed || requestId !== bootLoadRequestIdRef.current) {
          return;
        }
        setErrorMessage(
          error instanceof Error
            ? error.message
            : tr("Nie udało się wczytać danych startowych.", "Failed to load initial data."),
        );
      } finally {
        if (!isDisposed && requestId === bootLoadRequestIdRef.current) {
          setIsBootLoading(false);
        }
      }
    }

    void loadBootData();

    return () => {
      isDisposed = true;
    };
  }, [client, chooseDefaultSession, normalizeSessions, onDefaultSession, setErrorMessage]);

  useEffect(() => {
    let isDisposed = false;
    const requestId = snapshotLoadRequestIdRef.current + 1;
    snapshotLoadRequestIdRef.current = requestId;

    async function loadSnapshotPayloadLazy() {
      if (!client) {
        setSnapshotPayload(null);
        return;
      }

      try {
        const snapshotResult = await client
          .from("forum_snapshot_cache")
          .select("payload")
          .eq("snapshot_key", "forum")
          .maybeSingle<{ payload: ForumSnapshotPayload }>();

        if (isDisposed || requestId !== snapshotLoadRequestIdRef.current) {
          return;
        }

        if (snapshotResult.error) {
          setSnapshotPayload(null);
          return;
        }

        setSnapshotPayload(snapshotResult.data?.payload ?? null);
      } catch {
        if (isDisposed || requestId !== snapshotLoadRequestIdRef.current) {
          return;
        }
        setSnapshotPayload(null);
      }
    }

    void loadSnapshotPayloadLazy();

    return () => {
      isDisposed = true;
    };
  }, [client]);

  return {
    sessions,
    members,
    snapshotPayload,
    isBootLoading,
    setSessions,
  };
}

type UseAttendanceEntriesParams = {
  client: typeof supabaseAuthClient;
  selectedCanonicalEventId: string | null;
  setErrorMessage: (message: string | null) => void;
};

type UseAttendanceEntriesResult = {
  entriesByMemberId: Record<string, number>;
  isEntriesLoading: boolean;
  setEntriesByMemberId: Dispatch<SetStateAction<Record<string, number>>>;
};

export function useAttendanceEntries({
  client,
  selectedCanonicalEventId,
  setErrorMessage,
}: UseAttendanceEntriesParams): UseAttendanceEntriesResult {
  const [entriesByMemberId, setEntriesByMemberId] = useState<Record<string, number>>({});
  const [isEntriesLoading, setIsEntriesLoading] = useState(false);
  const entriesLoadRequestIdRef = useRef(0);

  useEffect(() => {
    let isDisposed = false;
    const requestId = entriesLoadRequestIdRef.current + 1;
    entriesLoadRequestIdRef.current = requestId;

    async function loadEntries() {
      if (!client || !selectedCanonicalEventId) {
        setEntriesByMemberId({});
        setIsEntriesLoading(false);
        return;
      }

      setIsEntriesLoading(true);
      setErrorMessage(null);
      try {
        const { data, error } = await client
          .from("attendance_entries")
          .select("member_id,attendance_ratio")
          .eq("event_id", selectedCanonicalEventId);

        if (isDisposed || requestId !== entriesLoadRequestIdRef.current) {
          return;
        }

        if (error) {
          throw new Error(error.message);
        }

        const map: Record<string, number> = {};
        for (const entry of (data ?? []) as AttendanceEntryRow[]) {
          map[entry.member_id] = Number(entry.attendance_ratio);
        }
        setEntriesByMemberId(map);
      } catch (error) {
        if (isDisposed || requestId !== entriesLoadRequestIdRef.current) {
          return;
        }
        setEntriesByMemberId({});
        setErrorMessage(
          error instanceof Error
            ? error.message
            : tr("Nie udało się wczytać wpisów obecności.", "Failed to load attendance entries."),
        );
      } finally {
        if (!isDisposed && requestId === entriesLoadRequestIdRef.current) {
          setIsEntriesLoading(false);
        }
      }
    }

    void loadEntries();

    return () => {
      isDisposed = true;
    };
  }, [client, selectedCanonicalEventId, setErrorMessage]);

  return {
    entriesByMemberId,
    isEntriesLoading,
    setEntriesByMemberId,
  };
}
