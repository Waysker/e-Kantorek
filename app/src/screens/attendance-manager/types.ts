export type MemberRow = {
  member_id: string;
  full_name: string;
  instrument: string;
  is_active: boolean;
};

export type SessionRow = {
  event_id: string;
  title: string;
  event_date: string;
  source_header: string | null;
  source_column: string | null;
  source_sheet_id?: string | null;
  forum_event_id?: string | null;
};

export type AttendanceEntryRow = {
  member_id: string;
  attendance_ratio: number;
};

export type SnapshotAttendanceParticipant = {
  fullName?: string;
};

export type SnapshotAttendanceGroup = {
  status?: string;
  participants?: SnapshotAttendanceParticipant[];
};

export type SnapshotEventDetail = {
  /** Forum event id ("forum-event-<tid>"): the key in eventDetailsById. */
  id?: string;
  title?: string;
  startsAt?: string;
  attendanceGroups?: SnapshotAttendanceGroup[];
};

export type ForumSnapshotPayload = {
  eventDetailsById?: Record<string, SnapshotEventDetail>;
};
