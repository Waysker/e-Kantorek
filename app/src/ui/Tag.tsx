import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";

type TagProps = {
  label: string;
  style?: StyleProp<ViewStyle>;
};

// Neutral label marking something as the user's own ("Twoja"). Not a count
// (that is the amber Badge) and not a status (StatusPill).
export function Tag({ label, style }: TagProps) {
  return (
    <View style={[styles.tag, style]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  tag: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: tokens.radii.round,
    backgroundColor: colors.neutralSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.neutralInk,
  },
}));
