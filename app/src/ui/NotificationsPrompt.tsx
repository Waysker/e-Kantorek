import { Text, View } from "react-native";

import { tr } from "../i18n";
import { textStyles } from "../theme/text";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { Button } from "./Button";
import { Card } from "./Card";
import { Icon } from "./Icon";
import { Notice } from "./Notice";

type NotificationsPromptProps = {
  busy?: boolean;
  errorMessage?: string | null;
  /** Opens the browser's permission dialog (needs this tap). */
  onEnable: () => void;
  onDismiss: () => void;
};

// The one-time Start card that asks about push notifications (Partytura →
// Patterns → Notifications). Neutral, not amber: nothing waits on the member.
export function NotificationsPrompt({ busy, errorMessage, onEnable, onDismiss }: NotificationsPromptProps) {
  return (
    <Card>
      <View style={styles.header}>
        <Icon name="bell" size={20} color={colors.ink} />
        <Text style={styles.title}>{tr("Powiadomienia", "Notifications")}</Text>
      </View>
      <Text style={styles.body}>
        {tr(
          "Daj znać, gdy pojawi się nowe wydarzenie albo wpis w Kantorku.",
          "Tell me about new events and new posts in Kantorek.",
        )}
      </Text>
      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
      <View style={styles.actions}>
        <Button label={tr("Włącz", "Turn on")} onPress={onEnable} loading={busy} />
        <Button label={tr("Nie teraz", "Not now")} variant="secondary" onPress={onDismiss} disabled={busy} />
      </View>
    </Card>
  );
}

const styles = themedStyles(() => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.xs,
  },
  title: textStyles.sectionTitle,
  body: {
    ...textStyles.body,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.sm,
    marginTop: 4,
  },
}));
