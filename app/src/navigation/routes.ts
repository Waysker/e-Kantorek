export type PrimaryTab = "events" | "calendar" | "attendance" | "roles" | "instruments" | "profile";
export type AttendanceFocusStatus = "going" | "not_going";

export type AppRoute =
  | { name: "events" }
  | { name: "calendar" }
  | { name: "eventDetail"; eventId: string }
  | { name: "attendance"; eventId: string; focusStatus?: AttendanceFocusStatus }
  | { name: "setlist"; eventId: string }
  | { name: "squad"; eventId: string }
  | { name: "attendanceWorkspace" }
  | { name: "attendanceManager" }
  | { name: "attendanceSummary" }
  | { name: "roleManagement" }
  | { name: "instrumentMapping" }
  | { name: "profile" };

export function routeToTab(route: AppRoute): PrimaryTab {
  if (route.name === "profile") {
    return "profile";
  }

  if (route.name === "calendar") {
    return "calendar";
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

  if (route.name === "instrumentMapping") {
    return "instruments";
  }

  return "events";
}
