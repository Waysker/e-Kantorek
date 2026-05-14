export type PrimaryTab = "events" | "attendance" | "roles" | "profile";

export type AppRoute =
  | { name: "events" }
  | { name: "eventDetail"; eventId: string }
  | { name: "attendance"; eventId: string }
  | { name: "setlist"; eventId: string }
  | { name: "squad"; eventId: string }
  | { name: "attendanceWorkspace" }
  | { name: "attendanceManager" }
  | { name: "attendanceSummary" }
  | { name: "roleManagement" }
  | { name: "profile" };

export function routeToTab(route: AppRoute): PrimaryTab {
  if (route.name === "profile") {
    return "profile";
  }

  if (
    route.name === "attendanceWorkspace" ||
    route.name === "attendanceManager" ||
    route.name === "attendanceSummary"
  ) {
    return "attendance";
  }

  if (route.name === "roleManagement") {
    return "roles";
  }

  return "events";
}
