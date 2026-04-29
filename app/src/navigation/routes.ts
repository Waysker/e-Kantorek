export type PrimaryTab = "events" | "profile";

export type AppRoute =
  | { name: "events" }
  | { name: "eventDetail"; eventId: string }
  | { name: "attendance"; eventId: string }
  | { name: "setlist"; eventId: string }
  | { name: "squad"; eventId: string }
  | { name: "attendanceManager" }
  | { name: "attendanceSummary" }
  | { name: "roleManagement" }
  | { name: "profile" };

export function routeToTab(route: AppRoute): PrimaryTab {
  if (
    route.name === "profile" ||
    route.name === "attendanceManager" ||
    route.name === "attendanceSummary" ||
    route.name === "roleManagement"
  ) {
    return "profile";
  }

  return "events";
}
