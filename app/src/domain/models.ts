export type PrimaryRole = "member" | "leader" | "admin";
export type AttendanceStatus = "going" | "maybe" | "not_going" | "no_response";

export type UserProfile = {
  id: string;
  fullName: string;
  role: PrimaryRole;
  primaryInstrument?: string;
};

export type FeedPost = {
  id: string;
  authorName: string;
  kindLabel: string;
  title?: string;
  body: string;
  commentCount: number;
  createdAt: string;
  isPinned: boolean;
};

export type EventListItem = {
  id: string;
  title: string;
  startsAt: string;
  venue?: string;
  preview: string;
  attendanceStatus: AttendanceStatus;
  attendanceLabel: string;
  updateCount: number;
  commentCount: number;
};

export type EventUpdate = {
  id: string;
  authorName: string;
  createdAt: string;
  body: string;
};

export type EventComment = {
  id: string;
  authorName: string;
  createdAt: string;
  body: string;
};

export type AttendanceSummary = {
  going: number;
  maybe: number;
  notGoing: number;
  noResponse: number;
  userStatus: AttendanceStatus;
  userStatusLabel: string;
};

export type AttendanceParticipant = {
  id: string;
  fullName: string;
  primaryInstrument?: string;
};

export type AttendanceResponseGroup = {
  status: AttendanceStatus;
  label: string;
  count: number;
  participants: AttendanceParticipant[];
};

export type SetlistItem = {
  id: string;
  label: string;
  detail?: string;
};

export type SetlistSection = {
  id: string;
  title: string;
  items: SetlistItem[];
};

export type EventSetlist = {
  eventId: string;
  preview: string;
  modeHint: "fit" | "scroll";
  sections: SetlistSection[];
};

export type SquadMember = {
  id: string;
  fullName: string;
};

export type SquadGroup = {
  instrument: string;
  confirmedMembers: SquadMember[];
  maybeMembers: SquadMember[];
};

export type SquadComposition = {
  eventId: string;
  groups: SquadGroup[];
};

export type EventDetail = EventListItem & {
  description: string;
  updates: EventUpdate[];
  comments: EventComment[];
  attendanceSummary: AttendanceSummary;
  attendanceGroups: AttendanceResponseGroup[];
  setlist: EventSetlist;
  squad: SquadComposition;
};
