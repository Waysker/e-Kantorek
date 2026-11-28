// Kantorek screens: the feed, one post with comments, a new post
// (Partytura → Patterns → Kantorek (feed)).
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, View, useWindowDimensions } from "react-native";

import { tr } from "../i18n";
import { textStyles } from "../theme/text";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { Button } from "../ui/Button";
import { Card, listRowStyles } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { Icon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
import { TextField } from "../ui/TextField";
import { formatRelativeLabel } from "../utils/format";
import { AccountPickerModal } from "./AccountPicker";
import { ConfirmModal, LinkedText, PostCard } from "./FeedParts";
import {
  MAX_ATTACHMENTS,
  addComment,
  createPost,
  deleteComment,
  deletePost,
  getPost,
  listFeed,
  listMembers,
  setAuthor,
  pickFiles,
  prepareFile,
  setPinned,
  updateComment,
  updatePost,
  type FeedComment,
  type FeedMember,
  type FeedPost,
  type NewAttachment,
} from "./feedApi";

function useContentStyle() {
  const { width } = useWindowDimensions();
  return [styles.content, width >= tokens.breakpoints.desktop && styles.contentDesktop];
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <Pressable onPress={onBack} accessibilityRole="button" style={styles.back} hitSlop={8}>
      <Icon name="chevronLeft" size={20} color={colors.ink} />
      <Text style={styles.backLabel}>{tr("Kantorek", "Kantorek")}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- feed

export function FeedScreen({
  onOpenPost,
  onCompose,
  onImport,
}: {
  onOpenPost: (postId: string) => void;
  onCompose: () => void;
  /** Board/admin: "Import z Facebooka". */
  onImport?: () => void;
}) {
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const page = await listFeed();
      setPosts(page);
      setHasMore(page.filter((post) => !post.pinned).length >= 20);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    const last = [...(posts ?? [])].reverse().find((post) => !post.pinned);
    if (!last) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await listFeed(last.createdAt);
      setPosts((current) => [...(current ?? []), ...page]);
      setHasMore(page.length >= 20);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function reloadOne(postId: string) {
    try {
      const { post } = await getPost(postId);
      setPosts((current) =>
        post ? (current ?? []).map((item) => (item.id === postId ? post : item)) : current,
      );
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={useContentStyle()}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{tr("Kantorek", "Kantorek")}</Text>
        <Button label={tr("Nowy wpis", "New post")} onPress={onCompose} />
      </View>
      {onImport ? (
        <Pressable onPress={onImport} accessibilityRole="button" style={styles.textAction}>
          <Text style={styles.textActionLabel}>{tr("Import z Facebooka", "Import from Facebook")}</Text>
        </Pressable>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {posts === null && !error ? <ActivityIndicator color={colors.brand} /> : null}
      {posts && posts.length === 0 ? (
        <EmptyState title={tr("Jeszcze nic tu nie ma.", "Nothing here yet.")}>
          {tr("Napisz pierwszy wpis: ogłoszenie, pytanie albo ankietę.", "Write the first post: a notice, a question or a poll.")}
        </EmptyState>
      ) : null}
      {(posts ?? []).map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onOpen={() => onOpenPost(post.id)}
          onChanged={(next) => setPosts((current) => (current ?? []).map((item) => (item.id === next.id ? next : item)))}
          onReload={() => void reloadOne(post.id)}
        />
      ))}
      {hasMore ? (
        <Button
          label={tr("Pokaż starsze", "Show older")}
          variant="secondary"
          onPress={() => void loadMore()}
          loading={loadingMore}
        />
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- one post

export function FeedPostScreen({
  postId,
  isModerator,
  onBack,
}: {
  postId: string;
  isModerator: boolean;
  onBack: () => void;
}) {
  const [post, setPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState<{ id: string; body: string } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; label: string; run: () => Promise<void> } | null>(null);
  const [members, setMembers] = useState<FeedMember[] | null>(null);
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await getPost(postId);
      setPost(result.post);
      setComments(result.comments);
      setMissing(result.post === null);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function send() {
    const body = comment.trim();
    if (!body) {
      return;
    }
    setSending(true);
    await run(async () => {
      await addComment(postId, body);
      setComment("");
      await load();
    });
    setSending(false);
  }

  const canDeletePost = Boolean(post && (post.mine || isModerator));

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={useContentStyle()} keyboardShouldPersistTaps="handled">
      <BackLink onBack={onBack} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {missing ? (
        <EmptyState title={tr("Tego wpisu już nie ma.", "This post is gone.")}>
          {tr("Autor albo zarząd go usunął.", "Its author or the board deleted it.")}
        </EmptyState>
      ) : null}
      {!post && !missing && !error ? <ActivityIndicator color={colors.brand} /> : null}

      {post && editingPost !== null ? (
        <Card>
          <TextField
            label={tr("Treść wpisu", "Post text")}
            value={editingPost}
            onChangeText={setEditingPost}
            multiline
            numberOfLines={6}
          />
          <View style={styles.actionsRow}>
            <Button label={tr("Anuluj", "Cancel")} variant="secondary" onPress={() => setEditingPost(null)} />
            <Button
              label={tr("Zapisz", "Save")}
              onPress={() =>
                void run(async () => {
                  await updatePost(post.id, editingPost);
                  setEditingPost(null);
                  await load();
                })
              }
            />
          </View>
        </Card>
      ) : post ? (
        <PostCard post={post} expanded onChanged={setPost} onReload={() => void load()} />
      ) : null}

      {post && editingPost === null && (post.mine || isModerator) ? (
        <View style={styles.textActions}>
          {post.mine || (isModerator && post.source === "facebook") ? (
            <Pressable onPress={() => setEditingPost(post.body)} accessibilityRole="button" style={styles.textAction}>
              <Text style={styles.textActionLabel}>{tr("Edytuj", "Edit")}</Text>
            </Pressable>
          ) : null}
          {isModerator ? (
            <Pressable
              onPress={() =>
                void run(async () => {
                  await setPinned(post.id, !post.pinned);
                  await load();
                })
              }
              accessibilityRole="button"
              style={styles.textAction}
            >
              <Text style={styles.textActionLabel}>{post.pinned ? tr("Odepnij", "Unpin") : tr("Przypnij", "Pin")}</Text>
            </Pressable>
          ) : null}
          {isModerator && post.source === "facebook" ? (
            <Pressable
              onPress={() =>
                post.authorId
                  ? void run(async () => {
                      await setAuthor(post.id, null);
                      await load();
                    })
                  : void run(async () => {
                      setMembers(members ?? (await listMembers()));
                      setLinking(true);
                    })
              }
              accessibilityRole="button"
              style={styles.textAction}
            >
              <Text style={styles.textActionLabel}>
                {post.authorId ? tr("Odłącz od konta", "Unlink account") : tr("Połącz z kontem", "Link to account")}
              </Text>
            </Pressable>
          ) : null}
          {canDeletePost ? (
            <Pressable
              onPress={() =>
                setConfirm({
                  message: tr("Usunąć ten wpis razem z komentarzami?", "Delete this post with its comments?"),
                  label: tr("Usuń", "Delete"),
                  run: async () => {
                    await deletePost(post.id);
                    onBack();
                  },
                })
              }
              accessibilityRole="button"
              style={styles.textAction}
            >
              <Text style={styles.textActionDanger}>{tr("Usuń", "Delete")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {post ? (
        <Card variant="list">
          {comments.map((item, index) => (
            <View key={item.id} style={[styles.comment, index > 0 && listRowStyles.divider]}>
              <Text style={styles.commentAuthor}>
                {item.authorName}
                <Text style={styles.meta}>
                  {"  "}
                  {formatRelativeLabel(item.createdAt)}
                  {item.editedAt ? tr(" · edytowany", " · edited") : ""}
                </Text>
              </Text>
              {editingComment?.id === item.id ? (
                <>
                  <TextField
                    value={editingComment.body}
                    onChangeText={(body) => setEditingComment({ id: item.id, body })}
                    multiline
                    accessibilityLabel={tr("Treść komentarza", "Comment text")}
                  />
                  <View style={styles.actionsRow}>
                    <Button label={tr("Anuluj", "Cancel")} variant="secondary" onPress={() => setEditingComment(null)} />
                    <Button
                      label={tr("Zapisz", "Save")}
                      onPress={() =>
                        void run(async () => {
                          await updateComment(item.id, editingComment.body);
                          setEditingComment(null);
                          await load();
                        })
                      }
                    />
                  </View>
                </>
              ) : (
                <LinkedText text={item.body} />
              )}
              {editingComment?.id !== item.id && (item.mine || isModerator) ? (
                <View style={styles.commentActions}>
                  {item.mine ? (
                    <Pressable onPress={() => setEditingComment({ id: item.id, body: item.body })} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.smallAction}>{tr("Edytuj", "Edit")}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() =>
                      setConfirm({
                        message: tr("Usunąć ten komentarz?", "Delete this comment?"),
                        label: tr("Usuń", "Delete"),
                        run: async () => {
                          await deleteComment(item.id);
                          await load();
                        },
                      })
                    }
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text style={styles.smallActionDanger}>{tr("Usuń", "Delete")}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
          <View style={[styles.commentComposer, comments.length > 0 && listRowStyles.divider]}>
            <TextField
              value={comment}
              onChangeText={setComment}
              placeholder={tr("Napisz komentarz…", "Write a comment…")}
              accessibilityLabel={tr("Komentarz", "Comment")}
              multiline
              numberOfLines={2}
            />
            <Button
              label={tr("Wyślij", "Send")}
              variant="secondary"
              onPress={() => void send()}
              disabled={comment.trim().length === 0}
              loading={sending}
            />
          </View>
        </Card>
      ) : null}

      <AccountPickerModal
        visible={linking}
        members={members ?? []}
        initialName={post?.authorName ?? ""}
        onClose={() => setLinking(false)}
        onPick={(profileId) => {
          setLinking(false);
          if (post) {
            void run(async () => {
              await setAuthor(post.id, profileId);
              await load();
            });
          }
        }}
      />
      <ConfirmModal
        message={confirm?.message ?? null}
        confirmLabel={confirm?.label ?? ""}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action) {
            void run(action.run);
          }
        }}
      />
    </ScrollView>
  );
}

// ---------------------------------------------------------------- new post

export function FeedComposeScreen({ onBack, onPublished }: { onBack: () => void; onPublished: (postId: string) => void }) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<NewAttachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canPickFiles = Platform.OS === "web";

  async function addFiles() {
    setError(null);
    const picked = await pickFiles();
    if (picked.length === 0) {
      return;
    }
    const room = MAX_ATTACHMENTS - files.length;
    if (picked.length > room) {
      setError(tr(`Najwyżej ${MAX_ATTACHMENTS} załączników we wpisie.`, `At most ${MAX_ATTACHMENTS} attachments.`));
    }
    setPreparing(true);
    try {
      const prepared: NewAttachment[] = [];
      for (const file of picked.slice(0, Math.max(0, room))) {
        prepared.push(await prepareFile(file));
      }
      setFiles((current) => [...current, ...prepared]);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPreparing(false);
    }
  }

  const pollOptions = options.map((option) => option.trim()).filter(Boolean);
  const pollValid = !pollOpen || (question.trim().length > 0 && pollOptions.length >= 2);
  const hasContent = body.trim().length > 0 || files.length > 0 || pollOpen;

  async function publish() {
    if (!pollValid) {
      setError(tr("Ankieta potrzebuje pytania i co najmniej 2 odpowiedzi.", "A poll needs a question and at least 2 options."));
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      const postId = await createPost(
        body,
        files,
        pollOpen ? { question: question.trim(), multiple, options: pollOptions } : null,
      );
      onPublished(postId);
    } catch (reason) {
      setError((reason as Error).message);
      setPublishing(false);
    }
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={useContentStyle()} keyboardShouldPersistTaps="handled">
      <BackLink onBack={onBack} />
      <Text style={styles.title}>{tr("Nowy wpis", "New post")}</Text>
      <Card>
        <TextField
          value={body}
          onChangeText={setBody}
          placeholder={tr("Co słychać?", "What's up?")}
          accessibilityLabel={tr("Treść wpisu", "Post text")}
          multiline
          maxLength={5000}
          numberOfLines={6}
        />

        {files.map((file, index) => (
          <View key={`${file.fileName}-${index}`} style={styles.fileRow}>
            <Icon name="image" size={18} color={colors.muted} />
            <Text style={styles.fileName} numberOfLines={1}>
              {file.fileName}
            </Text>
            <Pressable
              onPress={() => setFiles((current) => current.filter((_, at) => at !== index))}
              accessibilityRole="button"
              accessibilityLabel={tr(`Usuń ${file.fileName}`, `Remove ${file.fileName}`)}
              hitSlop={8}
              style={styles.removeButton}
            >
              <Text style={styles.smallActionDanger}>{tr("Usuń", "Remove")}</Text>
            </Pressable>
          </View>
        ))}

        {pollOpen ? (
          <View style={styles.pollEditor}>
            <TextField label={tr("Pytanie", "Question")} value={question} onChangeText={setQuestion} maxLength={300} />
            {options.map((option, index) => (
              <View key={index} style={styles.optionRow}>
                <TextField
                  value={option}
                  onChangeText={(text) =>
                    setOptions((current) => current.map((value, at) => (at === index ? text : value)))
                  }
                  placeholder={tr(`Odpowiedź ${index + 1}`, `Option ${index + 1}`)}
                  accessibilityLabel={tr(`Odpowiedź ${index + 1}`, `Option ${index + 1}`)}
                  maxLength={200}
                  style={styles.optionField}
                />
                {options.length > 2 ? (
                  <Pressable
                    onPress={() => setOptions((current) => current.filter((_, at) => at !== index))}
                    accessibilityRole="button"
                    accessibilityLabel={tr(`Usuń odpowiedź ${index + 1}`, `Remove option ${index + 1}`)}
                    hitSlop={8}
                    style={styles.removeButton}
                  >
                    <Text style={styles.smallActionDanger}>{tr("Usuń", "Remove")}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {options.length < 10 ? (
              <Pressable onPress={() => setOptions((current) => [...current, ""])} accessibilityRole="button" style={styles.textAction}>
                <Text style={styles.textActionLabel}>{tr("Dodaj odpowiedź", "Add option")}</Text>
              </Pressable>
            ) : null}
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{tr("Wiele odpowiedzi", "Multiple answers")}</Text>
              <Switch
                value={multiple}
                onValueChange={setMultiple}
                trackColor={{ true: colors.brand, false: colors.controlBorder }}
                accessibilityLabel={tr("Wiele odpowiedzi", "Multiple answers")}
              />
            </View>
            <Pressable onPress={() => setPollOpen(false)} accessibilityRole="button" style={styles.textAction}>
              <Text style={styles.textActionDanger}>{tr("Usuń ankietę", "Remove poll")}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.composeTools}>
          {canPickFiles && files.length < MAX_ATTACHMENTS ? (
            <Pressable onPress={() => void addFiles()} accessibilityRole="button" style={styles.tool} disabled={preparing}>
              <Icon name="image" size={20} color={colors.ink} />
              <Text style={styles.toolLabel}>
                {preparing ? tr("Przygotowuję…", "Preparing…") : tr("Dodaj zdjęcie lub plik", "Add photo or file")}
              </Text>
            </Pressable>
          ) : null}
          {pollOpen ? null : (
            <Pressable onPress={() => setPollOpen(true)} accessibilityRole="button" style={styles.tool}>
              <Icon name="poll" size={20} color={colors.ink} />
              <Text style={styles.toolLabel}>{tr("Dodaj ankietę", "Add poll")}</Text>
            </Pressable>
          )}
        </View>
      </Card>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button
        label={tr("Opublikuj", "Publish")}
        size="lg"
        onPress={() => void publish()}
        disabled={!hasContent || preparing}
        loading={publishing}
      />
    </ScrollView>
  );
}

const styles = themedStyles((colors) => ({
  scroll: {
    flex: 1,
  },
  content: {
    padding: tokens.spacing.md,
    paddingTop: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  contentDesktop: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: tokens.spacing.xl,
    paddingTop: tokens.spacing.xl,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing.sm,
  },
  title: textStyles.pageTitle,
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
    alignSelf: "flex-start",
  },
  backLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  meta: {
    fontSize: 13,
    fontWeight: "400",
    color: colors.muted,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: tokens.spacing.sm,
  },
  textActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: tokens.spacing.md,
  },
  textAction: {
    minHeight: 44,
    justifyContent: "center",
  },
  textActionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.brand,
  },
  textActionDanger: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.dangerInk,
  },
  comment: {
    padding: tokens.spacing.md,
    gap: 4,
  },
  commentAuthor: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  commentActions: {
    flexDirection: "row",
    gap: tokens.spacing.md,
  },
  smallAction: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
  },
  smallActionDanger: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.dangerInk,
  },
  commentComposer: {
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
    minHeight: 44,
  },
  fileName: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
  },
  removeButton: {
    minHeight: 44,
    justifyContent: "center",
  },
  pollEditor: {
    gap: tokens.spacing.sm,
    paddingTop: tokens.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  optionField: {
    flex: 1,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  switchLabel: {
    fontSize: 15,
    color: colors.ink,
  },
  composeTools: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spacing.md,
    paddingTop: tokens.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },
  tool: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
  },
  toolLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
}));
