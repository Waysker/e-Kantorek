// Pieces of the Kantorek feed (Partytura → Patterns → Kantorek (feed)): post
// card, attachments, poll, "Lubię to", people list, confirmation.
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";

import { tr } from "../i18n";
import { textStyles } from "../theme/text";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
import { Tag } from "../ui/Tag";
import { formatRelativeLabel } from "../utils/format";
import { listPeople, toggleLike, vote, type FeedAttachment, type FeedPoll, type FeedPost } from "./feedApi";

const URL_PATTERN = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'])/g;

function surnameKey(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

export function sortBySurname(names: string[]) {
  return [...names].sort(
    (left, right) => surnameKey(left).localeCompare(surnameKey(right), "pl") || left.localeCompare(right, "pl"),
  );
}

export function plural(count: number, one: string, few: string, many: string) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (count === 1) {
    return `1 ${one}`;
  }
  return `${count} ${last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many}`;
}

export function openUrl(url: string) {
  if (typeof window !== "undefined" && typeof window.open === "function") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  void Linking.openURL(url);
}

/** Text with line breaks kept and links tappable. */
export function LinkedText({ text, numberOfLines }: { text: string; numberOfLines?: number }) {
  const parts = text.split(URL_PATTERN);
  return (
    <Text style={styles.body} numberOfLines={numberOfLines}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Text key={index} style={styles.link} onPress={() => openUrl(part)} accessibilityRole="link">
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

export function AttachmentsView({ attachments, compact }: { attachments: FeedAttachment[]; compact?: boolean }) {
  const images = attachments.filter((attachment) => attachment.kind === "image");
  const files = attachments.filter((attachment) => attachment.kind === "file");
  const [first, ...rest] = images;
  const shownRest = compact ? rest.slice(0, 3) : rest;
  const hidden = rest.length - shownRest.length;
  return (
    <View style={styles.attachments}>
      {first ? (
        <Pressable onPress={() => first.url && openUrl(first.url)} accessibilityRole="imagebutton" accessibilityLabel={first.fileName}>
          {first.url ? (
            <Image
              source={{ uri: first.url }}
              style={[
                styles.imageLarge,
                first.width && first.height
                  ? { aspectRatio: Math.max(4 / 3, first.width / first.height) }
                  : null,
              ]}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.imageLarge, styles.imageMissing]} />
          )}
        </Pressable>
      ) : null}
      {shownRest.length > 0 ? (
        <View style={styles.thumbRow}>
          {shownRest.map((image, index) => (
            <Pressable
              key={image.id}
              onPress={() => image.url && openUrl(image.url)}
              accessibilityRole="imagebutton"
              accessibilityLabel={image.fileName}
              style={styles.thumbWrap}
            >
              {image.url ? <Image source={{ uri: image.url }} style={styles.thumb} resizeMode="cover" /> : null}
              {index === shownRest.length - 1 && hidden > 0 ? (
                <View style={styles.thumbMore}>
                  <Text style={styles.thumbMoreLabel}>+{hidden}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {files.map((file) => (
        <Pressable
          key={file.id}
          onPress={() => file.url && openUrl(file.url)}
          accessibilityRole="link"
          style={styles.fileRow}
        >
          <Text style={styles.fileName} numberOfLines={1}>
            {file.fileName}
          </Text>
          <Icon name="external" size={16} color={colors.muted} />
        </Pressable>
      ))}
    </View>
  );
}

export function PeopleModal({
  title,
  load,
  onClose,
}: {
  title: string;
  load: (() => Promise<string[]>) | null;
  onClose: () => void;
}) {
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!load) {
      return;
    }
    let cancelled = false;
    setNames(null);
    setError(null);
    load()
      .then((result) => !cancelled && setNames(sortBySurname(result)))
      .catch((reason: Error) => !cancelled && setError(reason.message));
    return () => {
      cancelled = true;
    };
  }, [load]);
  return (
    <Modal visible={load !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {!names && !error ? <ActivityIndicator color={colors.brand} /> : null}
          <ScrollView style={styles.sheetList}>
            {(names ?? []).map((name, index) => (
              <Text key={`${name}-${index}`} style={styles.sheetName}>
                {name}
              </Text>
            ))}
          </ScrollView>
          <Button label={tr("Zamknij", "Close")} variant="secondary" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ConfirmModal({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string | null;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={message !== null} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{message}</Text>
          <View style={styles.sheetActions}>
            <Button label={tr("Anuluj", "Cancel")} variant="secondary" onPress={onCancel} />
            <Button label={confirmLabel} onPress={onConfirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function PollView({
  postId,
  poll,
  onChanged,
}: {
  postId: string;
  poll: FeedPoll;
  onChanged: () => void;
}) {
  const voted = poll.options.some((option) => option.mine);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<{ title: string; load: () => Promise<string[]> } | null>(null);
  const showResults = voted && !editing;
  const total = Math.max(1, ...poll.options.map((option) => option.votes));

  async function submit(optionIds: string[]) {
    setBusy(true);
    setError(null);
    try {
      await vote(postId, optionIds);
      setEditing(false);
      setPicked([]);
      onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pick(optionId: string) {
    if (poll.multiple) {
      setPicked((current) =>
        current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId],
      );
      return;
    }
    void submit([optionId]);
  }

  return (
    <View style={styles.poll}>
      <Text style={styles.pollQuestion}>{poll.question}</Text>
      {poll.options.map((option) => {
        const selected = showResults ? option.mine : picked.includes(option.id);
        return (
          <Pressable
            key={option.id}
            disabled={busy || showResults}
            onPress={() => pick(option.id)}
            accessibilityRole={poll.multiple ? "checkbox" : "radio"}
            accessibilityState={{ checked: selected, disabled: busy || showResults }}
            style={styles.pollOption}
          >
            {showResults ? (
              <View style={[styles.pollBar, { width: `${(option.votes / total) * 100}%` }]} />
            ) : null}
            {showResults ? null : (
              <View style={[poll.multiple ? styles.checkbox : styles.radio, selected && styles.markOn]}>
                {selected ? <Text style={styles.markLabel}>✓</Text> : null}
              </View>
            )}
            <Text style={[styles.pollLabel, showResults && option.mine && styles.pollLabelMine]}>
              {showResults && option.mine ? "✓ " : ""}
              {option.label}
            </Text>
            {showResults ? (
              <Pressable
                onPress={() =>
                  setPeople({ title: option.label, load: () => listPeople(postId, option.id) })
                }
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={tr(`Kto głosował na ${option.label}`, `Who voted for ${option.label}`)}
              >
                <Text style={styles.pollCount}>{option.votes}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <View style={styles.pollFooter}>
        <Text style={styles.meta}>{plural(poll.voterCount, "osoba głosowała", "osoby głosowały", "osób głosowało")}</Text>
        {showResults ? (
          <Pressable onPress={() => setEditing(true)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.linkSmall}>{tr("Zmień głos", "Change vote")}</Text>
          </Pressable>
        ) : poll.multiple ? (
          <Button
            label={tr("Głosuj", "Vote")}
            variant="secondary"
            onPress={() => void submit(picked)}
            disabled={picked.length === 0}
            loading={busy}
          />
        ) : busy ? (
          <ActivityIndicator color={colors.brand} />
        ) : null}
      </View>
      <PeopleModal title={people?.title ?? ""} load={people?.load ?? null} onClose={() => setPeople(null)} />
    </View>
  );
}

export function PostCard({
  post,
  expanded,
  onOpen,
  onChanged,
  onReload,
  menu,
}: {
  post: FeedPost;
  /** Full text, all attachments (the post screen). */
  expanded?: boolean;
  onOpen?: () => void;
  onChanged: (next: FeedPost) => void;
  /** Fetch the post again (after a vote). */
  onReload: () => void;
  /** Edit / delete / pin actions, shown in the header. */
  menu?: ReactNode;
}) {
  const [likeBusy, setLikeBusy] = useState(false);
  const [people, setPeople] = useState<(() => Promise<string[]>) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const longText = !expanded && (post.body.split("\n").length > 6 || post.body.length > 420);

  async function like() {
    setLikeBusy(true);
    setError(null);
    const optimistic = !post.likedByMe;
    onChanged({ ...post, likedByMe: optimistic, likeCount: post.likeCount + (optimistic ? 1 : -1) });
    try {
      await toggleLike(post.id);
    } catch (reason) {
      onChanged(post);
      setError((reason as Error).message);
    } finally {
      setLikeBusy(false);
    }
  }

  const content = (
    <>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.author}>{post.authorName}</Text>
          <Text style={styles.meta}>
            {formatRelativeLabel(post.createdAt)}
            {post.editedAt ? tr(" · edytowany", " · edited") : ""}
          </Text>
        </View>
        {post.pinned ? <Tag label={tr("Przypięte", "Pinned")} /> : null}
        {menu}
      </View>
      {post.body ? <LinkedText text={post.body} numberOfLines={expanded ? undefined : 6} /> : null}
      {longText ? <Text style={styles.linkSmall}>{tr("Więcej", "More")}</Text> : null}
    </>
  );

  return (
    <Card>
      {onOpen ? (
        <Pressable onPress={onOpen} accessibilityRole="button" style={styles.openArea}>
          {content}
        </Pressable>
      ) : (
        content
      )}
      {post.attachments.length > 0 ? <AttachmentsView attachments={post.attachments} compact={!expanded} /> : null}
      {post.poll ? (
        <PollView postId={post.id} poll={post.poll} onChanged={onReload} />
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <View style={styles.footer}>
        <View style={styles.likeGroup}>
          <Pressable
            onPress={() => void like()}
            disabled={likeBusy}
            accessibilityRole="button"
            accessibilityState={{ selected: post.likedByMe }}
            accessibilityLabel={tr("Lubię to", "Like")}
            style={styles.likeButton}
          >
            <Icon name="thumb" size={20} color={post.likedByMe ? colors.brand : colors.muted} filled={post.likedByMe} />
          </Pressable>
          {post.likeCount > 0 ? (
            <Pressable
              onPress={() => setPeople(() => () => listPeople(post.id, null))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={tr("Kto polubił", "Who liked it")}
            >
              <Text style={styles.footerLabel}>{post.likeCount}</Text>
            </Pressable>
          ) : null}
        </View>
        {onOpen ? (
          <Pressable onPress={onOpen} hitSlop={8} accessibilityRole="button" style={styles.commentsLink}>
            <Text style={styles.footerLabel}>
              {post.commentCount > 0
                ? plural(post.commentCount, "komentarz", "komentarze", "komentarzy")
                : tr("Skomentuj", "Comment")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <PeopleModal title={tr("Lubią to", "Liked by")} load={people} onClose={() => setPeople(null)} />
    </Card>
  );
}

const styles = themedStyles((colors) => ({
  body: {
    ...textStyles.body,
    color: colors.ink,
  },
  link: {
    color: colors.brand,
    textDecorationLine: "underline",
  },
  linkSmall: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.brand,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
  },
  openArea: {
    gap: tokens.spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  author: textStyles.rowTitle,
  attachments: {
    gap: tokens.spacing.xs,
  },
  imageLarge: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: tokens.radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  imageMissing: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumbRow: {
    flexDirection: "row",
    gap: tokens.spacing.xs,
  },
  thumbWrap: {
    width: 72,
    height: 72,
    borderRadius: tokens.radii.sm,
    overflow: "hidden",
    backgroundColor: colors.surfaceMuted,
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  thumbMore: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  thumbMoreLabel: {
    color: colors.onStrong,
    fontWeight: "700",
    fontSize: 16,
  },
  fileRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.sm,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  fileName: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
  },
  poll: {
    gap: tokens.spacing.xs,
  },
  pollQuestion: textStyles.sectionTitle,
  pollOption: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.sm,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    overflow: "hidden",
  },
  pollBar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.surfaceMuted,
  },
  pollLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
  },
  pollLabelMine: {
    fontWeight: "600",
  },
  pollCount: {
    minWidth: 28,
    textAlign: "right",
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  pollFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
    minHeight: 32,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.controlBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.controlBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  markOn: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  markLabel: {
    color: colors.onBrand,
    fontSize: 12,
    fontWeight: "800",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
    paddingTop: tokens.spacing.xs,
  },
  likeGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  likeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  commentsLink: {
    minHeight: 44,
    justifyContent: "center",
  },
  footerLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.muted,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.spacing.md,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "80%",
    backgroundColor: colors.surface,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  sheetTitle: textStyles.sectionTitle,
  sheetList: {
    flexGrow: 0,
  },
  sheetName: {
    fontSize: 15,
    paddingVertical: 6,
    color: colors.ink,
  },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: tokens.spacing.sm,
  },
}));
