import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

export type IconName =
  | "home"
  | "bell"
  | "list"
  | "calendar"
  | "board"
  | "user"
  | "external"
  | "chevronLeft"
  | "chevronRight";

type IconProps = {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
};

// Simple stroke icons (24px grid) shared by navigation and actions.
export function Icon({ name, size = 22, color, strokeWidth = 2 }: IconProps) {
  const common = {
    stroke: color,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };

  return (
    // Decorative: the wrapper hides the icon from assistive tech on all platforms.
    <View aria-hidden pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {name === "home" ? (
          <Path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" {...common} />
        ) : null}
        {name === "bell" ? (
          <>
            <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" {...common} />
            <Path d="M10 20a2 2 0 0 0 4 0" {...common} />
          </>
        ) : null}
        {name === "list" ? (
          <>
            <Path d="M9 6h11M9 12h11M9 18h11" {...common} />
            <Circle cx={4.5} cy={6} r={1} {...common} />
            <Circle cx={4.5} cy={12} r={1} {...common} />
            <Circle cx={4.5} cy={18} r={1} {...common} />
          </>
        ) : null}
        {name === "calendar" ? (
          <>
            <Rect x={3} y={5} width={18} height={16} rx={2} {...common} />
            <Path d="M3 10h18M8 3v4M16 3v4" {...common} />
          </>
        ) : null}
        {name === "board" ? (
          <>
            <Rect x={5} y={4} width={14} height={17} rx={2} {...common} />
            <Path d="M9 4V3h6v1M9 11h6M9 15h4" {...common} />
          </>
        ) : null}
        {name === "user" ? (
          <>
            <Circle cx={12} cy={8} r={4} {...common} />
            <Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" {...common} />
          </>
        ) : null}
        {name === "external" ? <Path d="M7 17L17 7M9 7h8v8" {...common} /> : null}
        {name === "chevronLeft" ? <Path d="M15 6l-6 6 6 6" {...common} /> : null}
        {name === "chevronRight" ? <Path d="M9 6l6 6-6 6" {...common} /> : null}
      </Svg>
    </View>
  );
}
