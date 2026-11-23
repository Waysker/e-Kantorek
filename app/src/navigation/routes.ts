export type PrimaryTab = "home" | "events" | "calendar" | "board" | "profile";
export type BoardSection = "attendance" | "roles" | "instruments";
export type AttendanceFocusStatus = "going" | "not_going";

export type AppRoute =
  | { name: "home" }
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
  if (route.name === "home") {
    return "home";
  }

  if (route.name === "profile") {
    return "profile";
  }

  if (route.name === "calendar") {
    return "calendar";
  }

  if (
    route.name === "attendanceWorkspace" ||
    route.name === "attendanceManager" ||
    route.name === "attendanceSummary" ||
    route.name === "roleManagement" ||
    route.name === "instrumentMapping"
  ) {
    return "board";
  }

  return "events";
}

export function routeToBoardSection(route: AppRoute): BoardSection | null {
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
  return null;
}
