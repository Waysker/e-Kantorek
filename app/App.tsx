import { StatusBar } from "expo-status-bar";
import { startTransition, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";

import type { OraghInstrument } from "./src/auth/instruments";
import { isSupabaseAuthConfigured, supabaseAuthClient } from "./src/auth/supabaseAuthClient";
import { describeAuthError } from "./src/auth/authErrorMessage";
import { createPrototypeRepositories } from "./src/data/prototypeRepositories";
import type {
  AppNotification,
  AppNotificationKind,
  EventDetail,
  EventListItem,
  UserProfile,
} from "./src/domain/models";
import {
  canViewAttendanceSummaryByRole,
  canWriteAttendanceByRole,
  canManageRolesByRole,
  normalizePrimaryRole,
} from "./src/domain/roles";
import type { AppRoute, BoardSection, PrimaryTab } from "./src/navigation/routes";
import { routeToBoardSection } from "./src/navigation/routes";
import { BoardSubNav } from "./src/ui/BoardSubNav";
import { routeToTab } from "./src/navigation/routes";
import { AttendanceScreen } from "./src/screens/AttendanceScreen";
import { EventDetailScreen } from "./src/screens/EventDetailScreen";
import { EventsHubScreen, type EventsView } from "./src/screens/EventsHubScreen";
import { StartScreen } from "./src/screens/StartScreen";
import { CalendarScreen } from "./src/screens/CalendarScreen";
import { EventsScreen } from "./src/screens/EventsScreen";
import { AuthScreen } from "./src/screens/AuthScreen";
import { MissingEventScreen } from "./src/screens/MissingEventScreen";
import { AttendanceManagerScreen } from "./src/screens/AttendanceManagerScreen";
import { AttendanceSummaryScreen } from "./src/screens/AttendanceSummaryScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { RegisterScreen } from "./src/screens/RegisterScreen";
import { InstrumentMappingScreen } from "./src/screens/InstrumentMappingScreen";
import { RoleManagementScreen } from "./src/screens/RoleManagementScreen";
import { SetlistScreen } from "./src/screens/SetlistScreen";
import { SquadScreen } from "./src/screens/SquadScreen";
import { tr } from "./src/i18n";
import { tokens } from "./src/theme/tokens";
import { AppShell } from "./src/ui/AppShell";
import { UnmappedMembersBanner } from "./src/ui/UnmappedMembersBanner";
import {
  canManageInstrumentMappingByRole,
  canSeeUnmappedMembersAlertByRole,
  findUnmappedSquadMembers,
} from "./src/domain/unmappedMembers";

const repositories = createPrototypeRepositories();

type LoadedData = {
  currentUser: UserProfile;
  events: EventListItem[];
  eventDetailsById: Record<string, EventDetail>;
  dataSourceLabel: string;
  dataSourceGeneratedAt: string | null;
  authProfile: {
    fullName: string;
    primaryInstrument: string;
    role: UserProfile["role"];
  } | null;
};

type AppState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: LoadedData };

type AuthState =
  | { status: "checking" }
  | { status: "signed_out" }
  | { status: "signed_in"; session: Session }
  | { status: "config_error" };

type ProfileRow = {
  first_name: string;
  last_name: string;
  full_name: string;
  instrument: string;
  role: string;
};

type ProfileMemberLinkRow = { member_id: string };
type LinkedMemberRow = { full_name: string };

function normalizeIdentityName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pl")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function applySignedInUserAttendance(
  events: EventListItem[],
  details: EventDetail[],
  identityNames: string[],
): { events: EventListItem[]; details: Record<string, EventDetail> } {
  const names = new Set(identityNames.map(normalizeIdentityName).filter(Boolean));
  const updatedDetails = details.map((event) => {
    const matchingResponses = event.attendanceGroups.filter((group) =>
      group.participants.some((participant) => names.has(normalizeIdentityName(participant.fullName))),
    );
    const userStatus: EventDetail["attendanceSummary"]["userStatus"] = matchingResponses.length === 1
      ? matchingResponses[0].status
      : "no_response";
    const userStatusLabel = userStatus === "going"
      ? tr("Będę", "Going")
      : userStatus === "maybe"
        ? tr("Może", "Maybe")
        : userStatus === "not_going"
          ? tr("Nie będę", "Not going")
          : tr("Brak deklaracji", "No response");
    return {
      ...event,
      attendanceStatus: userStatus,
      attendanceLabel: userStatusLabel,
      attendanceSummary: { ...event.attendanceSummary, userStatus, userStatusLabel },
    };
  });
  const detailMap = Object.fromEntries(updatedDetails.map((event) => [event.id, event]));
  return {
    events: events.map((event) => {
      const detail = detailMap[event.id];
      return detail
        ? { ...event, attendanceStatus: detail.attendanceStatus, attendanceLabel: detail.attendanceLabel }
        : event;
    }),
    details: detailMap,
  };
}

type NotificationRow = {
  id?: string;
  kind?: string;
  title?: string;
  body?: string;
  ref_type?: string | null;
  ref_id?: string | null;
  created_at?: string;
  read_at?: string | null;
};

type ReminderDispatchResult = {
  notifiedCount: number;
  notifiedFullNames: string[];
};

type AuthView = "sign_in" | "register";
const ROOT_ROUTE: AppRoute = { name: "home" };
const HISTORY_STATE_MARKER = "__oragh_route_stack__";
const NOTIFICATION_FETCH_LIMIT = 80;

function normalizeNotificationRows(rows: NotificationRow[]): AppNotification[] {
  return rows
    .map((row) => {
      const id = String(row.id ?? "").trim();
      const kind = String(row.kind ?? "").trim() as AppNotificationKind;
      const title = String(row.title ?? "").trim();
      const body = String(row.body ?? "").trim();
      const createdAt = String(row.created_at ?? "").trim();

      if (!id || !kind || !title || !body || !createdAt) {
        return null;
      }

      return {
        id,
        kind,
        title,
        body,
        refType:
          typeof row.ref_type === "string" && row.ref_type.trim().length > 0
            ? row.ref_type.trim()
            : null,
        refId:
          typeof row.ref_id === "string" && row.ref_id.trim().length > 0
            ? row.ref_id.trim()
            : null,
        createdAt,
        readAt:
          typeof row.read_at === "string" && row.read_at.trim().length > 0
            ? row.read_at.trim()
            : null,
      } satisfies AppNotification;
    })
    .filter((entry): entry is AppNotification => entry !== null)
    .sort((left, right) => {
      const leftTimestamp = Date.parse(left.createdAt);
      const rightTimestamp = Date.parse(right.createdAt);
      if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)) {
        return rightTimestamp - leftTimestamp;
      }
      return right.createdAt.localeCompare(left.createdAt, "pl");
    });
}

function isSameRoute(left: AppRoute, right: AppRoute): boolean {
  if (left.name !== right.name) {
    return false;
  }

  if (!("eventId" in left) && !("eventId" in right)) {
    return true;
  }

  if ("eventId" in left && "eventId" in right) {
    if (left.eventId !== right.eventId) {
      return false;
    }

    if (left.name === "attendance" && right.name === "attendance") {
      return left.focusStatus === right.focusStatus;
    }

    return true;
  }

  return false;
}

function isValidAppRoute(value: unknown): value is AppRoute {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { name?: unknown; eventId?: unknown; focusStatus?: unknown };
  if (typeof candidate.name !== "string") {
    return false;
  }

  if (
    candidate.name === "home" ||
    candidate.name === "events" ||
    candidate.name === "calendar" ||
    candidate.name === "instrumentMapping" ||
    candidate.name === "profile" ||
    candidate.name === "attendanceWorkspace" ||
    candidate.name === "attendanceManager" ||
    candidate.name === "attendanceSummary" ||
    candidate.name === "roleManagement"
  ) {
    return true;
  }

  if (
    candidate.name === "eventDetail" ||
    candidate.name === "attendance" ||
    candidate.name === "setlist" ||
    candidate.name === "squad"
  ) {
    if (typeof candidate.eventId !== "string" || candidate.eventId.trim().length === 0) {
      return false;
    }

    if (candidate.name === "attendance") {
      if (candidate.focusStatus === undefined) {
        return true;
      }
      return candidate.focusStatus === "going" || candidate.focusStatus === "not_going";
    }

    return true;
  }

  return false;
}

function parseRouteStackFromHistoryState(state: unknown): AppRoute[] | null {
  if (!state || typeof state !== "object") {
    return null;
  }

  const stackValue = (state as Record<string, unknown>)[HISTORY_STATE_MARKER];
  if (!Array.isArray(stackValue) || stackValue.length === 0) {
    return null;
  }

  const parsedStack = stackValue.filter((entry): entry is AppRoute => isValidAppRoute(entry));
  if (parsedStack.length !== stackValue.length) {
    return null;
  }

  return parsedStack;
}

function areRouteStacksEqual(left: AppRoute[], right: AppRoute[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((route, index) => isSameRoute(route, right[index]));
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>({ status: "checking" });
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const [authInfoMessage, setAuthInfoMessage] = useState<string | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authView, setAuthView] = useState<AuthView>("sign_in");
  const [state, setState] = useState<AppState>({ status: "loading" });
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationsErrorMessage, setNotificationsErrorMessage] = useState<string | null>(null);
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(false);
  const [isMarkingNotificationsRead, setIsMarkingNotificationsRead] = useState(false);
  const [routeStack, setRouteStack] = useState<AppRoute[]>([ROOT_ROUTE]);
  const [lastEventsView, setLastEventsView] = useState<EventsView>("events");
  const route = routeStack[routeStack.length - 1] ?? ROOT_ROUTE;
  const browserHistoryRestoreRef = useRef(false);
  const isWeb = Platform.OS === "web";
  const authenticatedUserId =
    authState.status === "signed_in" ? authState.session.user.id : null;

  function pushRoute(nextRoute: AppRoute) {
    setRouteStack((current) => {
      const activeRoute = current[current.length - 1];
      if (activeRoute && isSameRoute(activeRoute, nextRoute)) {
        return current;
      }
      return [...current, nextRoute];
    });
  }

  function resetToRoute(nextRoute: AppRoute) {
    setRouteStack([nextRoute]);
  }

  function goBack(fallbackRoute: AppRoute = ROOT_ROUTE) {
    setRouteStack((current) => {
      if (current.length <= 1) {
        return [fallbackRoute];
      }
      return current.slice(0, -1);
    });
  }

  async function fetchNotifications(options?: { showLoading?: boolean }) {
    if (!supabaseAuthClient || !authenticatedUserId) {
      setNotifications([]);
      setNotificationsErrorMessage(null);
      setIsNotificationsLoading(false);
      return;
    }

    const showLoading = options?.showLoading ?? false;
    if (showLoading) {
      setIsNotificationsLoading(true);
    }

    const { data, error } = await supabaseAuthClient
      .from("notifications")
      .select("id,kind,title,body,ref_type,ref_id,created_at,read_at")
      .eq("user_id", authenticatedUserId)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_FETCH_LIMIT);

    if (error) {
      setNotificationsErrorMessage(error.message);
      if (showLoading) {
        setIsNotificationsLoading(false);
      }
      return;
    }

    setNotificationsErrorMessage(null);
    setNotifications(normalizeNotificationRows((data ?? []) as NotificationRow[]));
    if (showLoading) {
      setIsNotificationsLoading(false);
    }
  }

  async function handleMarkAllNotificationsRead() {
    if (!supabaseAuthClient || !authenticatedUserId) {
      return;
    }

    const unreadIds = notifications
      .filter((notification) => notification.readAt == null)
      .map((notification) => notification.id);

    if (unreadIds.length === 0) {
      return;
    }

    setIsMarkingNotificationsRead(true);
    setNotificationsErrorMessage(null);

    const { error } = await supabaseAuthClient
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", authenticatedUserId)
      .in("id", unreadIds);

    if (error) {
      setNotificationsErrorMessage(error.message);
      setIsMarkingNotificationsRead(false);
      return;
    }

    setNotifications((current) =>
      current.map((notification) =>
        unreadIds.includes(notification.id)
          ? { ...notification, readAt: new Date().toISOString() }
          : notification,
      ),
    );
    setIsMarkingNotificationsRead(false);
  }

  useEffect(() => {
    if (!isWeb || typeof window === "undefined") {
      return;
    }

    const existingStack = parseRouteStackFromHistoryState(window.history.state);
    if (existingStack && existingStack.length > 0) {
      browserHistoryRestoreRef.current = true;
      setRouteStack(existingStack);
    } else {
      window.history.replaceState({ [HISTORY_STATE_MARKER]: [ROOT_ROUTE] }, "");
    }

    const handlePopState = (event: PopStateEvent) => {
      const stackFromState = parseRouteStackFromHistoryState(event.state);
      if (!stackFromState || stackFromState.length === 0) {
        return;
      }

      browserHistoryRestoreRef.current = true;
      setRouteStack(stackFromState);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isWeb]);

  useEffect(() => {
    if (!isWeb || typeof window === "undefined") {
      return;
    }

    if (browserHistoryRestoreRef.current) {
      browserHistoryRestoreRef.current = false;
      return;
    }

    const currentStack = parseRouteStackFromHistoryState(window.history.state);
    if (currentStack && areRouteStacksEqual(currentStack, routeStack)) {
      return;
    }

    const nextState = { [HISTORY_STATE_MARKER]: routeStack };
    if (!window.history.state || parseRouteStackFromHistoryState(window.history.state) === null) {
      window.history.replaceState(nextState, "");
      return;
    }

    window.history.pushState(nextState, "");
  }, [isWeb, routeStack]);

  useEffect(() => {
    if (!isSupabaseAuthConfigured || !supabaseAuthClient) {
      // Developers: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      // (app/.env locally, GitHub Secrets for the Pages build); see app/README.md.
      console.warn("Auth not configured: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing.");
      setAuthState({ status: "config_error" });
      return;
    }

    let isCancelled = false;

    supabaseAuthClient.auth
      .getSession()
      .then(({ data, error }) => {
        if (isCancelled) {
          return;
        }

        if (error) {
          setAuthErrorMessage(describeAuthError(error, "session"));
          setAuthState({ status: "signed_out" });
          return;
        }

        if (data.session) {
          setAuthState({ status: "signed_in", session: data.session });
          setAuthInfoMessage(null);
          return;
        }

        setAuthState({ status: "signed_out" });
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        setAuthErrorMessage(describeAuthError(error, "session"));
        setAuthState({ status: "signed_out" });
      });

    const { data: listener } = supabaseAuthClient.auth.onAuthStateChange(
      (_event, session) => {
        if (isCancelled) {
          return;
        }

        if (session) {
          setAuthState({ status: "signed_in", session });
          setAuthErrorMessage(null);
          setAuthInfoMessage(null);
          return;
        }

        setAuthState({ status: "signed_out" });
      },
    );

    return () => {
      isCancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authenticatedUserId) {
      return;
    }

    let isCancelled = false;

    async function load() {
      try {
        const [currentUser, events, profileResult] = await Promise.all([
          repositories.users.getCurrentUser(),
          repositories.events.listEvents(),
          supabaseAuthClient
            ? supabaseAuthClient
                .from("profiles")
                .select("first_name,last_name,full_name,instrument,role")
                .eq("id", authenticatedUserId)
                .maybeSingle<ProfileRow>()
            : Promise.resolve({ data: null, error: null }),
        ]);

        if (profileResult.error) {
          throw profileResult.error;
        }

        const eventDetails = await Promise.all(
          events.map((event) => repositories.events.getEventDetail(event.id)),
        );

        const identityNames = [profileResult.data?.full_name ?? ""];
        if (supabaseAuthClient) {
          try {
            const { data: profileMemberLink } = await supabaseAuthClient
              .from("profile_member_links")
              .select("member_id")
              .eq("profile_id", authenticatedUserId)
              .maybeSingle<ProfileMemberLinkRow>();
            if (profileMemberLink?.member_id) {
              const { data: linkedMember } = await supabaseAuthClient
                .from("members")
                .select("full_name")
                .eq("member_id", profileMemberLink.member_id)
                .maybeSingle<LinkedMemberRow>();
              if (linkedMember?.full_name) {
                identityNames.unshift(linkedMember.full_name);
              }
            }
          } catch {
            // The profile name remains a usable identity fallback if optional linking is unavailable.
          }
        }

        const personalizedAttendance = applySignedInUserAttendance(
          events,
          eventDetails,
          identityNames,
        );

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          const dataSourceStatus = repositories.getDataSourceStatus();
          setState({
            status: "ready",
            data: {
              currentUser,
              events: personalizedAttendance.events,
              eventDetailsById: personalizedAttendance.details,
              dataSourceLabel: dataSourceStatus.label,
              dataSourceGeneratedAt: dataSourceStatus.generatedAt,
              authProfile: profileResult.data
                ? {
                    fullName: profileResult.data.full_name,
                    primaryInstrument: profileResult.data.instrument,
                    role: normalizePrimaryRole(profileResult.data.role),
                  }
                : null,
            },
          });
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : tr(
                  "Nie udało się wczytać wydarzeń.",
                  "Events could not be loaded.",
                ),
        });
      }
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [authenticatedUserId]);

  useEffect(() => {
    if (!authenticatedUserId || !supabaseAuthClient) {
      setNotifications([]);
      setNotificationsErrorMessage(null);
      setIsNotificationsLoading(false);
      return;
    }
    const client = supabaseAuthClient;

    let isCancelled = false;
    let needsPolling = true;

    const channel = client
      .channel(`notifications:${authenticatedUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${authenticatedUserId}`,
        },
        () => {
          if (isCancelled) {
            return;
          }
          void fetchNotifications();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          needsPolling = false;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          needsPolling = true;
        }
      });

    const intervalId = setInterval(() => {
      if (!needsPolling || isCancelled) {
        return;
      }
      void fetchNotifications();
    }, 45_000);

    void fetchNotifications({ showLoading: true });

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
      void client.removeChannel(channel);
    };
  }, [authenticatedUserId]);

  async function handleSignIn(email: string, password: string) {
    if (!supabaseAuthClient) {
      setAuthErrorMessage(
        tr("Logowanie nie jest skonfigurowane w tej wersji aplikacji.", "Sign-in is not configured in this build."),
      );
      return;
    }

    setIsAuthSubmitting(true);
    setAuthErrorMessage(null);
    setAuthInfoMessage(null);

    const { error } = await supabaseAuthClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthErrorMessage(describeAuthError(error, "sign_in"));
    }

    setIsAuthSubmitting(false);
  }

  async function handleRegister(payload: {
    firstName: string;
    lastName: string;
    instrument: OraghInstrument;
    email: string;
    password: string;
  }) {
    if (!supabaseAuthClient) {
      setAuthErrorMessage(
        tr("Logowanie nie jest skonfigurowane w tej wersji aplikacji.", "Sign-in is not configured in this build."),
      );
      return;
    }

    setIsAuthSubmitting(true);
    setAuthErrorMessage(null);
    setAuthInfoMessage(null);

    const fullName = `${payload.firstName} ${payload.lastName}`.trim();
    const { data, error } = await supabaseAuthClient.auth.signUp({
      email: payload.email,
      password: payload.password,
      options: {
        data: {
          firstName: payload.firstName,
          lastName: payload.lastName,
          fullName,
          instrument: payload.instrument,
          role: "member",
        },
      },
    });

    if (error) {
      setAuthErrorMessage(describeAuthError(error, "sign_up"));
      setIsAuthSubmitting(false);
      return;
    }

    if (!data.session) {
      setAuthInfoMessage(
        tr(
          "Konto utworzone. Potwierdź e-mail i zaloguj się ponownie.",
          "Account created. Check your email confirmation, then sign in.",
        ),
      );
      setAuthView("sign_in");
    }

    setIsAuthSubmitting(false);
  }

  async function handleSignOut() {
    if (!supabaseAuthClient) {
      return;
    }

    const { error } = await supabaseAuthClient.auth.signOut();

    if (error) {
      setAuthErrorMessage(describeAuthError(error, "sign_out"));
      return;
    }

    resetToRoute(ROOT_ROUTE);
    setState({ status: "loading" });
    setAuthView("sign_in");
  }

  function renderCenteredState({
    eyebrow,
    title,
    copy,
    showSpinner,
  }: {
    eyebrow?: string;
    title: string;
    copy: string;
    showSpinner?: boolean;
  }) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingScreen}>
          <StatusBar style="dark" />
          {showSpinner ? (
            <ActivityIndicator color={tokens.colors.brand} size="large" />
          ) : null}
          {eyebrow ? <Text style={styles.errorEyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.loadingTitle}>{title}</Text>
          <Text style={styles.loadingCopy}>{copy}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (authState.status === "checking") {
    return renderCenteredState({
      title: tr("Sprawdzam sesję", "Checking your session"),
      copy: tr(
        "Przygotowuję logowanie przed wczytaniem danych.",
        "Preparing sign-in before loading data.",
      ),
      showSpinner: true,
    });
  }

  if (authState.status === "config_error") {
    return renderCenteredState({
      eyebrow: tr("Logowanie niedostępne", "Sign-in unavailable"),
      title: tr("Logowanie nie jest skonfigurowane w tej wersji aplikacji.", "Sign-in is not configured in this build."),
      copy: tr(
        "Daj znać zarządowi, że aplikacja nie działa.",
        "Let the board know the app isn't working.",
      ),
    });
  }

  if (authState.status === "signed_out") {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {authView === "register" ? (
          <RegisterScreen
            onRegister={handleRegister}
            onGoToSignIn={() => {
              setAuthErrorMessage(null);
              setAuthInfoMessage(null);
              setAuthView("sign_in");
            }}
            isSubmitting={isAuthSubmitting}
            errorMessage={authErrorMessage}
          />
        ) : (
          <AuthScreen
            onSignIn={handleSignIn}
            onGoToRegister={() => {
              setAuthErrorMessage(null);
              setAuthInfoMessage(null);
              setAuthView("register");
            }}
            isSubmitting={isAuthSubmitting}
            errorMessage={authErrorMessage}
            infoMessage={authInfoMessage}
          />
        )}
      </SafeAreaProvider>
    );
  }

  if (state.status === "loading") {
    return renderCenteredState({
      title: tr("Wczytywanie…", "Loading…"),
      copy: tr(
        "Pobieram wydarzenia i deklaracje.",
        "Loading events and declarations.",
      ),
      showSpinner: true,
    });
  }

  if (state.status === "error") {
    return renderCenteredState({
      eyebrow: tr("Błąd", "Error"),
      title: tr("Nie udało się uruchomić aplikacji.", "The app could not start."),
      copy: state.message,
    });
  }

  const {
    currentUser,
    events,
    eventDetailsById,
    dataSourceLabel,
    dataSourceGeneratedAt,
    authProfile,
  } = state.data;
  const sessionUserMetadata = authState.session.user.user_metadata;
  const metadataFirstName =
    typeof sessionUserMetadata.firstName === "string"
      ? sessionUserMetadata.firstName.trim()
      : "";
  const metadataLastName =
    typeof sessionUserMetadata.lastName === "string"
      ? sessionUserMetadata.lastName.trim()
      : "";
  const metadataFullName =
    typeof sessionUserMetadata.fullName === "string"
      ? sessionUserMetadata.fullName.trim()
      : [metadataFirstName, metadataLastName].filter(Boolean).join(" ");
  const metadataInstrument =
    typeof sessionUserMetadata.instrument === "string"
      ? sessionUserMetadata.instrument.trim()
      : null;
  const effectiveCurrentUser: UserProfile = {
    ...currentUser,
    id: authState.session.user.id,
    fullName: authProfile?.fullName || metadataFullName || currentUser.fullName,
    primaryInstrument:
      authProfile?.primaryInstrument || metadataInstrument || currentUser.primaryInstrument,
    role: normalizePrimaryRole(authProfile?.role || currentUser.role),
  };
  const signedInEmail =
    authState.status === "signed_in" ? authState.session.user.email ?? null : null;
  const activeTab = routeToTab(route);
  const selectedEvent =
    "eventId" in route ? eventDetailsById[route.eventId] : undefined;
  const canWriteAttendance = canWriteAttendanceByRole(effectiveCurrentUser.role);
  const canViewAttendanceSummary = canViewAttendanceSummaryByRole(effectiveCurrentUser.role);
  // Reminders ("Ponaglij") are hidden for now; the code stays so the feature
  // can be revived on a branch by flipping this flag.
  const ATTENDANCE_REMINDERS_ENABLED = false;
  const canSendAttendanceReminders = ATTENDANCE_REMINDERS_ENABLED && canViewAttendanceSummary;
  const canManageRoles = canManageRolesByRole(effectiveCurrentUser.role);
  const canManageInstrumentMapping = canManageInstrumentMappingByRole(
    effectiveCurrentUser.role,
  );
  const canSeeUnmappedMembersAlert = canSeeUnmappedMembersAlertByRole(
    effectiveCurrentUser.role,
  );
  const unmappedMembers = canSeeUnmappedMembersAlert
    ? findUnmappedSquadMembers(eventDetailsById)
    : [];
  const boardSections: BoardSection[] = [
    ...(canWriteAttendance ? (["attendance"] as const) : []),
    ...(canViewAttendanceSummary ? (["summary"] as const) : []),
    ...(canManageRoles ? (["roles"] as const) : []),
    ...(canManageInstrumentMapping ? (["instruments"] as const) : []),
  ];
  // The old attendance hub route now opens the first attendance tool directly.
  const activeBoardSection =
    route.name === "attendanceWorkspace"
      ? canWriteAttendance
        ? "attendance"
        : "summary"
      : routeToBoardSection(route);
  const navigationTabs: PrimaryTab[] = [
    "home",
    "events",
    ...(boardSections.length > 0 ? (["board"] as const) : []),
    "profile",
  ];
  const unreadNotificationsCount = notifications.reduce(
    (count, notification) => (notification.readAt == null ? count + 1 : count),
    0,
  );

  async function handleRemindMissingDeclarations(
    eventId: string,
  ): Promise<ReminderDispatchResult> {
    if (!supabaseAuthClient) {
      throw new Error(
        tr("Logowanie nie jest skonfigurowane w tej wersji aplikacji.", "Sign-in is not configured in this build."),
      );
    }

    if (!canSendAttendanceReminders) {
      throw new Error(
        tr(
          "Tylko sekcyjni, zarząd i administratorzy mogą wysyłać ponaglenia.",
          "Only section/board/admin roles can send reminders.",
        ),
      );
    }

    const event = eventDetailsById[eventId];
    if (!event) {
      throw new Error(
        tr("Nie znaleziono wydarzenia.", "The selected event could not be found."),
      );
    }

    const declaredFullNames = event.attendanceGroups
      .filter((group) => group.status !== "no_response")
      .flatMap((group) => group.participants.map((participant) => participant.fullName));

    const payload = {
      p_event_id: event.id,
      p_event_title: event.title,
      p_declared_full_names: declaredFullNames,
    };

    const { data, error } = await supabaseAuthClient.rpc(
      "send_event_attendance_reminders_detailed",
      payload,
    );

    if (error) {
      if (error.code === "42883") {
        const legacyResult = await supabaseAuthClient.rpc(
          "send_event_attendance_reminders",
          payload,
        );

        if (legacyResult.error) {
          throw new Error(
            `send_event_attendance_reminders: ${legacyResult.error.message}`,
          );
        }

        const legacyCount =
          typeof legacyResult.data === "number" ? legacyResult.data : 0;
        return {
          notifiedCount: legacyCount,
          notifiedFullNames: [],
        };
      }

      throw new Error(`send_event_attendance_reminders_detailed: ${error.message}`);
    }

    const parsed =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;
    const parsedCount =
      parsed && typeof parsed.notified_count === "number"
        ? parsed.notified_count
        : parsed && typeof parsed.notified_count === "string"
          ? Number(parsed.notified_count)
          : 0;
    const notifiedFullNames =
      parsed && Array.isArray(parsed.notified_full_names)
        ? parsed.notified_full_names
            .map((entry) => String(entry ?? "").trim())
            .filter((entry) => entry.length > 0)
        : [];

    return {
      notifiedCount:
        Number.isFinite(parsedCount) && parsedCount > 0
          ? Math.trunc(parsedCount)
          : 0,
      notifiedFullNames,
    }
  }

  function openBoardSection(section: BoardSection) {
    if (section === "attendance") {
      resetToRoute({ name: "attendanceManager" });
      return;
    }
    if (section === "summary") {
      resetToRoute({ name: "attendanceSummary" });
      return;
    }
    if (section === "roles") {
      resetToRoute({ name: "roleManagement" });
      return;
    }
    resetToRoute({ name: "instrumentMapping" });
  }

  function openTab(tab: PrimaryTab) {
    if (tab === "home") {
      resetToRoute({ name: "home" });
      return;
    }

    if (tab === "events") {
      // Reopen the view (list or calendar) the user used last.
      resetToRoute({ name: lastEventsView });
      return;
    }

    if (tab === "board") {
      const firstSection = boardSections[0];
      if (firstSection) {
        openBoardSection(firstSection);
      } else {
        resetToRoute({ name: "events" });
      }
      return;
    }

    resetToRoute({ name: "profile" });
  }

  function renderScreen() {
    switch (route.name) {
      case "home":
        return (
          <StartScreen
            events={events}
            firstName={effectiveCurrentUser.fullName.trim().split(/\s+/)[0] || null}
            unreadNotificationsCount={unreadNotificationsCount}
            onOpenEvent={(eventId) => pushRoute({ name: "eventDetail", eventId })}
            onOpenEvents={() => resetToRoute({ name: "events" })}
            onOpenCalendar={() => {
              setLastEventsView("calendar");
              resetToRoute({ name: "calendar" });
            }}
            onOpenNotifications={() => resetToRoute({ name: "profile" })}
          />
        );
      case "events":
      case "calendar":
        return (
          <EventsHubScreen
            view={route.name}
            onChangeView={(view) => {
              setLastEventsView(view);
              resetToRoute({ name: view });
            }}
            renderList={() => (
              <EventsScreen
                events={events}
                hideTitle
                onOpenEvent={(eventId) => pushRoute({ name: "eventDetail", eventId })}
              />
            )}
            renderCalendar={() => (
              <CalendarScreen
                events={events}
                hideTitle
                onOpenEvent={(eventId) => pushRoute({ name: "eventDetail", eventId })}
              />
            )}
          />
        );
      case "eventDetail":
        if (!selectedEvent) {
          return (
            <MissingEventScreen
              onBack={() => goBack({ name: "events" })}
              title={tr("Nie znaleziono wydarzenia", "Event not found")}
            />
          );
        }

        return (
          <EventDetailScreen
            event={selectedEvent}
            onBack={() => goBack({ name: "events" })}
            onOpenAttendance={(focusStatus) =>
              pushRoute({ name: "attendance", eventId: selectedEvent.id, focusStatus })
            }
            onOpenSetlist={() =>
              pushRoute({ name: "setlist", eventId: selectedEvent.id })
            }
            canRemindMissingDeclarations={canSendAttendanceReminders}
            onRemindMissingDeclarations={
              canSendAttendanceReminders
                ? () => handleRemindMissingDeclarations(selectedEvent.id)
                : undefined
            }
          />
        );
      case "attendance":
        if (!selectedEvent) {
          return (
            <MissingEventScreen
              onBack={() => goBack({ name: "events" })}
              title={tr("Brak danych obecności", "Attendance unavailable")}
            />
          );
        }

        return (
          <AttendanceScreen
            event={selectedEvent}
            onBack={() => goBack({ name: "events" })}
            userInstrument={effectiveCurrentUser.primaryInstrument}
          />
        );
      case "setlist":
        if (!selectedEvent) {
          return (
            <MissingEventScreen
              onBack={() => goBack({ name: "events" })}
              title={tr("Brak setlisty", "Setlist unavailable")}
            />
          );
        }

        return (
          <SetlistScreen
            event={selectedEvent}
            onBack={() => goBack({ name: "events" })}
          />
        );
      case "squad":
        if (!selectedEvent) {
          return (
            <MissingEventScreen
              onBack={() => goBack({ name: "events" })}
              title={tr("Brak składu", "Squad unavailable")}
            />
          );
        }

        return (
          <SquadScreen
            event={selectedEvent}
            onBack={() => goBack({ name: "events" })}
            userInstrument={effectiveCurrentUser.primaryInstrument}
          />
        );
      case "profile":
        return (
          <ProfileScreen
            currentUser={effectiveCurrentUser}
            dataSourceLabel={dataSourceLabel}
            dataSourceGeneratedAt={dataSourceGeneratedAt}
            notifications={notifications}
            unreadNotificationsCount={unreadNotificationsCount}
            notificationsErrorMessage={notificationsErrorMessage}
            isNotificationsLoading={isNotificationsLoading}
            isMarkingNotificationsRead={isMarkingNotificationsRead}
            onRefreshNotifications={() => fetchNotifications({ showLoading: true })}
            onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
            signedInEmail={signedInEmail}
            onSignOut={handleSignOut}
          />
        );
      case "attendanceWorkspace":
        // Kept for links/history saved before the hub was removed.
        return canWriteAttendance ? (
          <AttendanceManagerScreen />
        ) : canViewAttendanceSummary ? (
          <AttendanceSummaryScreen />
        ) : (
          <MissingEventScreen
            onBack={() => goBack({ name: "events" })}
            title={tr("Brak uprawnień", "No permission")}
          />
        );
      case "attendanceManager":
        return canWriteAttendance ? (
          <AttendanceManagerScreen />
        ) : (
          <MissingEventScreen
            onBack={() => goBack({ name: "events" })}
            title={tr("Brak uprawnień", "No permission")}
          />
        );
      case "attendanceSummary":
        return canViewAttendanceSummary ? (
          <AttendanceSummaryScreen />
        ) : (
          <MissingEventScreen
            onBack={() => goBack({ name: "events" })}
            title={tr("Brak uprawnień", "No permission")}
          />
        );
      case "roleManagement":
        return canManageRoles ? (
          <RoleManagementScreen currentUserId={effectiveCurrentUser.id} />
        ) : (
          <MissingEventScreen
            onBack={() => goBack({ name: "events" })}
            title={tr("Brak uprawnień", "No permission")}
          />
        );
      case "instrumentMapping":
        return canManageInstrumentMapping ? (
          <InstrumentMappingScreen />
        ) : (
          <MissingEventScreen
            onBack={() => goBack({ name: "events" })}
            title={tr("Brak uprawnień", "No permission")}
          />
        );
      default:
        return null;
    }
  }

  return (
    <SafeAreaProvider>
      <AppShell
        tabs={navigationTabs}
        activeTab={activeTab}
        tabBadges={{
          ...(unreadNotificationsCount > 0 ? { profile: unreadNotificationsCount } : {}),
          ...(canManageInstrumentMapping && unmappedMembers.length > 0
            ? { board: unmappedMembers.length }
            : {}),
        }}
        hideNavigation={route.name === "setlist"}
        dataSourceLabel={dataSourceLabel}
        dataSourceGeneratedAt={dataSourceGeneratedAt}
        expectedSyncIntervalHours={2}
        alertBanner={
          // People who can assign instruments see a badge on "Zarząd" instead.
          canSeeUnmappedMembersAlert && !canManageInstrumentMapping ? (
            <UnmappedMembersBanner
              members={unmappedMembers}
              canAssign={canManageInstrumentMapping}
            />
          ) : undefined
        }
        onNavigate={openTab}
      >
        <StatusBar style={route.name === "setlist" ? "light" : "dark"} />
        {activeBoardSection ? (
          <BoardSubNav
            sections={boardSections}
            activeSection={activeBoardSection}
            badges={
              canManageInstrumentMapping && unmappedMembers.length > 0
                ? { instruments: unmappedMembers.length }
                : undefined
            }
            onSelect={openBoardSection}
          />
        ) : null}
        {renderScreen()}
      </AppShell>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.spacing.xl,
    backgroundColor: tokens.colors.background,
  },
  loadingTitle: {
    marginTop: tokens.spacing.md,
    fontSize: tokens.typography.title,
    fontWeight: "700",
    color: tokens.colors.ink,
    textAlign: "center",
  },
  loadingCopy: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.body,
    lineHeight: 22,
    textAlign: "center",
    color: tokens.colors.muted,
  },
  errorEyebrow: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: tokens.colors.muted,
  },
});
