import { StatusBar } from "expo-status-bar";
import { startTransition, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";

import type { OraghInstrument } from "./src/auth/instruments";
import { isSupabaseAuthConfigured, supabaseAuthClient } from "./src/auth/supabaseAuthClient";
import { createPrototypeRepositories } from "./src/data/prototypeRepositories";
import type {
  EventDetail,
  EventListItem,
  FeedPost,
  UserProfile,
} from "./src/domain/models";
import type { AppRoute, PrimaryTab } from "./src/navigation/routes";
import { routeToTab } from "./src/navigation/routes";
import { AttendanceScreen } from "./src/screens/AttendanceScreen";
import { EventDetailScreen } from "./src/screens/EventDetailScreen";
import { EventsScreen } from "./src/screens/EventsScreen";
import { FeedScreen } from "./src/screens/FeedScreen";
import { AuthScreen } from "./src/screens/AuthScreen";
import { MissingEventScreen } from "./src/screens/MissingEventScreen";
import { AttendanceSetupScreen } from "./src/screens/AttendanceSetupScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { RegisterScreen } from "./src/screens/RegisterScreen";
import { SetlistScreen } from "./src/screens/SetlistScreen";
import { SquadScreen } from "./src/screens/SquadScreen";
import { tr } from "./src/i18n";
import { tokens } from "./src/theme/tokens";
import { AppShell } from "./src/ui/AppShell";

const repositories = createPrototypeRepositories();

type LoadedData = {
  currentUser: UserProfile;
  feedPosts: FeedPost[];
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
  role: UserProfile["role"];
};

type AuthView = "sign_in" | "register";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>({ status: "checking" });
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const [authInfoMessage, setAuthInfoMessage] = useState<string | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authView, setAuthView] = useState<AuthView>("sign_in");
  const [state, setState] = useState<AppState>({ status: "loading" });
  const [route, setRoute] = useState<AppRoute>({ name: "feed" });
  const authenticatedUserId =
    authState.status === "signed_in" ? authState.session.user.id : null;

  useEffect(() => {
    if (!isSupabaseAuthConfigured || !supabaseAuthClient) {
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
          setAuthErrorMessage(error.message);
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

        setAuthErrorMessage(
          error instanceof Error
            ? error.message
            : tr("Nie udało się uruchomić logowania.", "Could not initialize auth."),
        );
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
        const [currentUser, feedPosts, events, profileResult] = await Promise.all([
          repositories.users.getCurrentUser(),
          repositories.feed.listFeedPosts(),
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

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          const dataSourceStatus = repositories.getDataSourceStatus();
          setState({
            status: "ready",
            data: {
              currentUser,
              feedPosts,
              events,
              eventDetailsById: Object.fromEntries(
                  eventDetails.map((event) => [event.id, event]),
                ),
              dataSourceLabel: dataSourceStatus.label,
              dataSourceGeneratedAt: dataSourceStatus.generatedAt,
              authProfile: profileResult.data
                ? {
                    fullName: profileResult.data.full_name,
                    primaryInstrument: profileResult.data.instrument,
                    role: profileResult.data.role,
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
                  "Nie udało się wczytać danych prototypu.",
                  "The prototype data could not be loaded.",
                ),
        });
      }
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [authenticatedUserId]);

  async function handleSignIn(email: string, password: string) {
    if (!supabaseAuthClient) {
      setAuthErrorMessage(
        tr("Supabase Auth nie jest skonfigurowany.", "Supabase auth is not configured."),
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
      setAuthErrorMessage(error.message);
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
        tr("Supabase Auth nie jest skonfigurowany.", "Supabase auth is not configured."),
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
      setAuthErrorMessage(error.message);
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
      setAuthErrorMessage(error.message);
      return;
    }

    setRoute({ name: "feed" });
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
        "Przygotowuję logowanie przed wczytaniem danych ORAGH.",
        "Preparing authentication before loading ORAGH data.",
      ),
      showSpinner: true,
    });
  }

  if (authState.status === "config_error") {
    return renderCenteredState({
      eyebrow: tr("Brak konfiguracji logowania", "Auth configuration missing"),
      title: tr("Supabase Auth nie jest skonfigurowany.", "Supabase auth is not configured."),
      copy: tr(
        "Ustaw EXPO_PUBLIC_SUPABASE_URL i EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY lokalnie w app/.env albo jako GitHub Secrets dla buildu Pages.",
        "Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in app/.env (local) or as GitHub Secrets for the Pages build.",
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
      title: tr("Wczytywanie prototypu ORAGH", "Loading ORAGH prototype"),
      copy: tr(
        "Pobieram tymczasowe źródła danych i mapuję je do modelu aplikacji.",
        "Reading the temporary data sources and mapping them into stable app models.",
      ),
      showSpinner: true,
    });
  }

  if (state.status === "error") {
    return renderCenteredState({
      eyebrow: tr("Błąd prototypu", "Prototype error"),
      title: tr("Nie udało się uruchomić aplikacji.", "The app could not bootstrap."),
      copy: state.message,
    });
  }

  const {
    currentUser,
    feedPosts,
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
    role: authProfile?.role || currentUser.role,
  };
  const signedInEmail =
    authState.status === "signed_in" ? authState.session.user.email ?? null : null;
  const activeTab = routeToTab(route);
  const selectedEvent =
    "eventId" in route ? eventDetailsById[route.eventId] : undefined;
  const canManageAttendanceSetup =
    effectiveCurrentUser.role === "admin" || effectiveCurrentUser.role === "leader";

  function openTab(tab: PrimaryTab) {
    if (tab === "feed") {
      setRoute({ name: "feed" });
      return;
    }

    if (tab === "events") {
      setRoute({ name: "events" });
      return;
    }

    setRoute({ name: "profile" });
  }

  function renderScreen() {
    switch (route.name) {
      case "feed":
        return (
          <FeedScreen
            currentUser={effectiveCurrentUser}
            feedPosts={feedPosts}
            onOpenEvents={() => setRoute({ name: "events" })}
          />
        );
      case "events":
        return (
          <EventsScreen
            events={events}
            onOpenEvent={(eventId) => setRoute({ name: "eventDetail", eventId })}
          />
        );
      case "eventDetail":
        if (!selectedEvent) {
          return (
            <MissingEventScreen
              onBack={() => setRoute({ name: "events" })}
              title={tr("Nie znaleziono wydarzenia", "Event not found")}
            />
          );
        }

        return (
          <EventDetailScreen
            event={selectedEvent}
            onBack={() => setRoute({ name: "events" })}
            onOpenAttendance={() =>
              setRoute({ name: "attendance", eventId: selectedEvent.id })
            }
            onOpenSetlist={() =>
              setRoute({ name: "setlist", eventId: selectedEvent.id })
            }
          />
        );
      case "attendance":
        if (!selectedEvent) {
          return (
            <MissingEventScreen
              onBack={() => setRoute({ name: "events" })}
              title={tr("Brak danych obecności", "Attendance unavailable")}
            />
          );
        }

        return (
          <AttendanceScreen
            event={selectedEvent}
            onBack={() =>
              setRoute({ name: "eventDetail", eventId: selectedEvent.id })
            }
          />
        );
      case "setlist":
        if (!selectedEvent) {
          return (
            <MissingEventScreen
              onBack={() => setRoute({ name: "events" })}
              title={tr("Brak setlisty", "Setlist unavailable")}
            />
          );
        }

        return (
          <SetlistScreen
            event={selectedEvent}
            onBack={() =>
              setRoute({ name: "eventDetail", eventId: selectedEvent.id })
            }
          />
        );
      case "squad":
        if (!selectedEvent) {
          return (
            <MissingEventScreen
              onBack={() => setRoute({ name: "events" })}
              title={tr("Brak składu", "Squad unavailable")}
            />
          );
        }

        return (
          <SquadScreen
            event={selectedEvent}
            onBack={() =>
              setRoute({ name: "eventDetail", eventId: selectedEvent.id })
            }
          />
        );
      case "profile":
        return (
          <ProfileScreen
            currentUser={effectiveCurrentUser}
            dataSourceLabel={dataSourceLabel}
            dataSourceGeneratedAt={dataSourceGeneratedAt}
            signedInEmail={signedInEmail}
            onSignOut={handleSignOut}
            canManageAttendanceSetup={canManageAttendanceSetup}
            onOpenAttendanceSetup={
              canManageAttendanceSetup
                ? () => setRoute({ name: "attendanceSetup" })
                : undefined
            }
          />
        );
      case "attendanceSetup":
        return canManageAttendanceSetup ? (
          <AttendanceSetupScreen
            currentUser={effectiveCurrentUser}
            onBack={() => setRoute({ name: "profile" })}
          />
        ) : (
          <MissingEventScreen
            onBack={() => setRoute({ name: "profile" })}
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
        activeTab={activeTab}
        hideNavigation={route.name === "setlist"}
        dataSourceLabel={dataSourceLabel}
        dataSourceGeneratedAt={dataSourceGeneratedAt}
        expectedSyncIntervalHours={4}
        onNavigate={openTab}
      >
        <StatusBar style={route.name === "setlist" ? "light" : "dark"} />
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
