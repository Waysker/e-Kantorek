export type PrimaryTab = "feed" | "events" | "profile";

export type AppRoute =
  | { name: "feed" }
  | { name: "events" }
  | { name: "eventDetail"; eventId: string }
  | { name: "attendance"; eventId: string }
  | { name: "setlist"; eventId: string }
  | { name: "squad"; eventId: string }
  | { name: "attendanceSetup" }
  | { name: "profile" };

export function routeToTab(route: AppRoute): PrimaryTab {
  if (route.name === "profile" || route.name === "attendanceSetup") {
    return "profile";
  }

  if (route.name === "feed") {
    return "feed";
  }

  return "events";
}
