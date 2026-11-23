import { Linking } from "react-native";

const DEFAULT_FORUM_BASE_URL = "https://www.oragh.agh.edu.pl/forum";

function getForumBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_FORUM_BASE_URL?.trim();
  return (configured || DEFAULT_FORUM_BASE_URL).replace(/\/+$/, "");
}

// Forum sync gives every event the id `forum-event-<tid>`, where <tid> is the
// MyBB thread id. The thread holds the declaration poll, so this is where
// members go to declare attendance.
export function getForumThreadUrl(eventId: string): string | null {
  const match = /^forum-event-(\d+)$/.exec(eventId);
  if (!match) {
    return null;
  }
  return `${getForumBaseUrl()}/showthread.php?tid=${match[1]}`;
}

export function openForumThread(eventId: string) {
  const url = getForumThreadUrl(eventId);
  if (url) {
    void Linking.openURL(url);
  }
}
