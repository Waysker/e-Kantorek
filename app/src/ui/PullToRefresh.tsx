import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, View, type ViewStyle } from "react-native";

import { colors, themedStyles } from "../theme/theme";

// Pull to refresh (Partytura → Patterns → Pull to refresh). Web on touch
// screens only: the installed app has no browser bar to reload with. Pulling
// down while every scroller under the finger is at its top moves a round
// indicator down; letting go past THRESHOLD reloads the page. The route stack
// lives in history.state, so the reload returns to the same screen.
const THRESHOLD = 70;
const MAX_PULL = 110;
const RESISTANCE = 0.5;
const SIZE = 40;

function isAtTop(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.documentElement) {
    if (node.scrollTop > 0) {
      return false;
    }
    node = node.parentElement;
  }
  return (document.scrollingElement?.scrollTop ?? 0) <= 0;
}

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef(0);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !("ontouchstart" in window)) {
      return;
    }
    // No second, native pull-to-refresh in a browser tab.
    const root = document.documentElement;
    const previousOverscroll = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "contain";
    document.body.style.overscrollBehaviorY = "contain";

    let startY: number | null = null;
    let tracking = false;

    const setDistance = (value: number) => {
      pullRef.current = value;
      setPull(value);
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        tracking = false;
        return;
      }
      tracking = isAtTop(event.target);
      startY = event.touches[0].clientY;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking || startY === null) {
        return;
      }
      const dy = event.touches[0].clientY - startY;
      if (dy <= 0) {
        if (pullRef.current > 0) {
          setDistance(0);
        }
        // Scrolling up the page: not a pull.
        if (dy < -4) {
          tracking = false;
        }
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      setDistance(Math.min(MAX_PULL, dy * RESISTANCE));
    };

    const onEnd = () => {
      if (!tracking) {
        return;
      }
      tracking = false;
      startY = null;
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true);
        setDistance(THRESHOLD);
        window.location.reload();
      } else {
        setDistance(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      root.style.overscrollBehaviorY = previousOverscroll;
      document.body.style.overscrollBehaviorY = "";
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (pull <= 0 && !refreshing) {
    return null;
  }

  const progress = Math.min(1, pull / THRESHOLD);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      style={[
        styles.indicator,
        {
          opacity: refreshing ? 1 : 0.25 + 0.75 * progress,
          transform: [{ translateY: pull - SIZE }],
        },
      ]}
    >
      <ActivityIndicator size="small" color={colors.brand} animating={refreshing || progress >= 1} hidesWhenStopped={false} />
    </View>
  );
}

const styles = themedStyles((colors) => ({
  indicator: {
    position: "fixed" as ViewStyle["position"],
    top: 8,
    left: "50%",
    marginLeft: -SIZE / 2,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
}));
