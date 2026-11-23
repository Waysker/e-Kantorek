import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { supabaseAuthClient } from "../auth/supabaseAuthClient";
import { CANONICAL_INSTRUMENT_OPTIONS } from "../domain/instruments";
import { tr } from "../i18n";
import { tokens } from "../theme/tokens";
import { SurfaceCard } from "../ui/SurfaceCard";

type UnmappedMemberRow = {
  memberId: string;
  fullName: string;
  forumUid: string | null;
  pendingInstrument: string | null;
};

type RawUnmappedMemberRow = {
  member_id?: string;
  full_name?: string;
  forum_uid?: string | null;
  pending_instrument?: string | null;
};

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

export function InstrumentMappingScreen() {
  const [members, setMembers] = useState<UnmappedMemberRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  async function loadMembers() {
    if (!supabaseAuthClient) {
      setIsLoading(false);
      setErrorMessage(
        tr("Supabase Auth nie jest skonfigurowany.", "Supabase auth is not configured."),
      );
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabaseAuthClient.rpc("list_unmapped_forum_members");
    if (error) {
      setIsLoading(false);
      setErrorMessage(error.message);
      return;
    }

    setMembers(
      (data ?? [])
        .map((row: unknown) => row as RawUnmappedMemberRow)
        .filter((row: RawUnmappedMemberRow) => toText(row.member_id).length > 0)
        .map((row: RawUnmappedMemberRow) => ({
          memberId: toText(row.member_id),
          fullName: toText(row.full_name) || tr("Nieznana osoba", "Unknown member"),
          forumUid: toText(row.forum_uid) || null,
          pendingInstrument: toText(row.pending_instrument) || null,
        })),
    );
    setIsLoading(false);
  }

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSelectInstrument(member: UnmappedMemberRow, instrument: string) {
    if (!supabaseAuthClient) {
      return;
    }

    setSavingMemberId(member.memberId);
    setErrorMessage(null);
    setInfoMessage(null);

    const { error } = await supabaseAuthClient.rpc("set_forum_member_instrument", {
      p_member_id: member.memberId,
      p_instrument: instrument,
    });

    setSavingMemberId(null);
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMembers((current) =>
      current.map((row) =>
        row.memberId === member.memberId ? { ...row, pendingInstrument: instrument } : row,
      ),
    );
    setInfoMessage(
      tr(
        `Zapisano: ${member.fullName} → ${instrument}. Zmiana pojawi się w składach po najbliższej synchronizacji forum (do ok. 20 min).`,
        `Saved: ${member.fullName} → ${instrument}. It will show in squads after the next forum sync (within ~20 min).`,
      ),
    );
  }

  const waitingCount = members.filter((member) => !member.pendingInstrument).length;

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <SurfaceCard variant="default">
        <Text style={styles.cardEyebrow}>{tr("Zarząd", "Board")}</Text>
        <Text style={styles.screenTitle}>{tr("Instrumenty z forum", "Forum instruments")}</Text>
        <Text style={styles.cardBody}>
          {tr(
            "Osoby z forum, które pojawiły się w składach, ale nie mają przypisanego instrumentu. Wybierz instrument, a zapis trafi do mappingu synchronizacji forum.",
            "Forum members who appear in squads but have no instrument yet. Pick an instrument and it is saved to the forum sync mapping.",
          )}
        </Text>
        <Text style={styles.cardSecondary}>
          {tr("Do przypisania", "To assign")}: {waitingCount}
        </Text>
      </SurfaceCard>

      {errorMessage ? (
        <SurfaceCard variant="outline">
          <Text style={styles.errorText}>{errorMessage}</Text>
        </SurfaceCard>
      ) : null}

      {infoMessage ? (
        <SurfaceCard variant="brandTint">
          <Text style={styles.infoText}>{infoMessage}</Text>
        </SurfaceCard>
      ) : null}

      {isLoading ? (
        <SurfaceCard variant="default">
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={tokens.colors.brand} />
            <Text style={styles.loadingText}>{tr("Wczytuję listę...", "Loading list...")}</Text>
          </View>
        </SurfaceCard>
      ) : members.length === 0 ? (
        <SurfaceCard variant="default">
          <Text style={styles.cardBody}>
            {tr(
              "Wszyscy mają przypisany instrument.",
              "Everyone has an instrument assigned.",
            )}
          </Text>
        </SurfaceCard>
      ) : (
        members.map((member) => {
          const isSaving = savingMemberId === member.memberId;

          return (
            <SurfaceCard key={member.memberId} variant="default">
              <Text style={styles.memberName}>{member.fullName}</Text>
              {member.forumUid ? (
                <Text style={styles.memberMeta}>UID forum: {member.forumUid}</Text>
              ) : null}
              {member.pendingInstrument ? (
                <Text style={styles.pendingText}>
                  {tr("Zapisano, czeka na synchronizację", "Saved, waiting for sync")}:{" "}
                  {member.pendingInstrument}
                </Text>
              ) : null}
              <View style={styles.optionsRow}>
                {CANONICAL_INSTRUMENT_OPTIONS.map((option) => {
                  const isSelected = member.pendingInstrument === option;
                  const isDisabled = Boolean(savingMemberId) || isSelected;

                  return (
                    <Pressable
                      key={`${member.memberId}-${option}`}
                      style={[
                        styles.optionButton,
                        isSelected && styles.optionButtonSelected,
                        isDisabled && styles.optionButtonDisabled,
                      ]}
                      disabled={isDisabled}
                      onPress={() => handleSelectInstrument(member, option)}
                    >
                      <Text
                        style={[
                          styles.optionLabel,
                          isSelected && styles.optionLabelSelected,
                        ]}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {isSaving ? (
                <Text style={styles.savingLabel}>{tr("Zapisywanie...", "Saving...")}</Text>
              ) : null}
            </SurfaceCard>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenScroll: {
    flex: 1,
  },
  screenContent: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  cardEyebrow: {
    fontSize: tokens.typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: tokens.colors.muted,
    marginBottom: tokens.spacing.xs,
    fontWeight: "700",
  },
  screenTitle: {
    fontSize: tokens.typography.title,
    lineHeight: 28,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  cardBody: {
    marginTop: tokens.spacing.sm,
    fontSize: tokens.typography.body,
    lineHeight: 23,
    color: tokens.colors.ink,
  },
  cardSecondary: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    color: tokens.colors.muted,
  },
  loadingWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  loadingText: {
    color: tokens.colors.muted,
    fontSize: tokens.typography.body,
  },
  memberName: {
    fontSize: tokens.typography.body,
    color: tokens.colors.ink,
    fontWeight: "700",
  },
  memberMeta: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    color: tokens.colors.muted,
    lineHeight: 18,
  },
  pendingText: {
    marginTop: tokens.spacing.xs,
    fontSize: tokens.typography.caption,
    color: tokens.colors.successInk,
    fontWeight: "700",
    lineHeight: 18,
  },
  optionsRow: {
    marginTop: tokens.spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.xs,
  },
  optionButton: {
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.round,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 6,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  optionButtonSelected: {
    backgroundColor: tokens.colors.brand,
    borderColor: tokens.colors.brand,
  },
  optionButtonDisabled: {
    opacity: 0.55,
  },
  optionLabel: {
    color: tokens.colors.ink,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  optionLabelSelected: {
    color: tokens.colors.surface,
  },
  savingLabel: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.brand,
    fontSize: tokens.typography.caption,
    fontWeight: "700",
  },
  errorText: {
    color: tokens.colors.dangerInk,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
  infoText: {
    color: tokens.colors.successInk,
    fontSize: tokens.typography.caption,
    lineHeight: 18,
    fontWeight: "700",
  },
});
