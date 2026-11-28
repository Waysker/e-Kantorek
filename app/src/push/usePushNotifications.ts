// Push notifications on this browser (Partytura → Patterns → Notifications):
// whether they can work here, the browser's permission, this device's
// subscription, and whether the member already answered the Start card.
// Web only; on native and where the browser cannot do push everything reports
// "unsupported" and the UI shows nothing.
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";

// Expo inlines EXPO_PUBLIC_* at build time (GitHub variable VAPID_PUBLIC_KEY in
// the deploy workflows). Not a secret: browsers need it to subscribe.
const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
const PROMPT_ANSWERED_KEY = "ekantorek.pushPrompt.answered";

export type PushState =
  | "unsupported"
  /** The browser blocked notifications for the site; only its settings can undo it. */
  | "blocked"
  | "off"
  | "on";

export type PushNotifications = {
  state: PushState;
  /** Show the Start card: can work here, not on yet, and not answered on this device. */
  shouldPrompt: boolean;
  busy: boolean;
  errorMessage: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  dismissPrompt: () => void;
};

function isPushSupported(): boolean {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    VAPID_PUBLIC_KEY.length > 0 &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function readAnswered(): boolean {
  try {
    return window.localStorage.getItem(PROMPT_ANSWERED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAnswered() {
  try {
    window.localStorage.setItem(PROMPT_ANSWERED_KEY, "1");
  } catch {
    // Private mode: the card may show again next time, nothing worse.
  }
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = window.atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  // index.html registers sw.js on load; wait for it rather than registering
  // twice. `ready` never settles without a worker (e.g. the dev server).
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no_service_worker")), 10_000)),
  ]);
}

async function saveSubscription(subscription: PushSubscription) {
  if (!supabaseAuthClient) {
    throw new Error("no_client");
  }
  const json = subscription.toJSON();
  const { error } = await supabaseAuthClient.rpc("register_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth_secret: json.keys?.auth ?? "",
    p_user_agent: navigator.userAgent,
  });
  if (error) {
    throw error;
  }
}

export function usePushNotifications(userId: string | null): PushNotifications {
  const supported = isPushSupported();
  const [state, setState] = useState<PushState>(supported ? "off" : "unsupported");
  const [answered, setAnswered] = useState(() => (supported ? readAnswered() : true));
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Current state; a subscription the browser still has is saved again for the
  // signed-in account (keys may rotate, another account may have used it).
  useEffect(() => {
    if (!supported || !userId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }
      try {
        const registration = await getRegistration();
        const subscription = await registration.pushManager.getSubscription();
        if (cancelled) {
          return;
        }
        if (subscription && Notification.permission === "granted") {
          setState("on");
          await saveSubscription(subscription).catch(() => undefined);
        } else {
          setState("off");
        }
      } catch {
        if (!cancelled) {
          setState("off");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, userId]);

  const dismissPrompt = useCallback(() => {
    writeAnswered();
    setAnswered(true);
  }, []);

  // Must run from a tap: browsers show the permission dialog only after one.
  const enable = useCallback(async () => {
    if (!supported) {
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      const permission = await Notification.requestPermission();
      // A "no" in the browser's dialog ends the Start card; a "yes" ends it
      // once saved; an error keeps it, with the message.
      if (permission !== "granted") {
        writeAnswered();
        setAnswered(true);
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await getRegistration();
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) as BufferSource,
        }));
      await saveSubscription(subscription);
      writeAnswered();
      setAnswered(true);
      setState("on");
    } catch {
      setErrorMessage("Nie udało się włączyć powiadomień. Spróbuj ponownie.");
    } finally {
      setBusy(false);
    }
  }, [supported]);

  const disable = useCallback(async () => {
    if (!supported) {
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      const registration = await getRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await supabaseAuthClient
          ?.rpc("unregister_push_subscription", { p_endpoint: subscription.endpoint })
          .then(({ error }) => {
            if (error) {
              throw error;
            }
          });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setErrorMessage("Nie udało się wyłączyć powiadomień. Spróbuj ponownie.");
    } finally {
      setBusy(false);
    }
  }, [supported]);

  return {
    state,
    shouldPrompt: supported && !answered && state === "off",
    busy,
    errorMessage,
    enable,
    disable,
    dismissPrompt,
  };
}
