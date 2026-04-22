export type PrimaryTab = "events" | "profile";

export type AppRoute =
  | { name: "events" }
  | { name: "eventDetail"; eventId: string }
  | { name: "attendance"; eventId: string }
  | { name: "setlist"; eventId: string }
  | { name: "squad"; eventId: string }
  | { name: "attendanceManager" }
  | { name: "profile" };

export function routeToTab(route: AppRoute): PrimaryTab {
  if (route.name === "profile" || route.name === "attendanceManager") {
    return "profile";
  }

  return "events";
}
