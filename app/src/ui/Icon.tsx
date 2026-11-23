import Svg, { Circle, Path, Rect } from "react-native-svg";

export type IconName =
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
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
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
  );
}
