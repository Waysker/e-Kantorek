// Board/admin: copy a post from the Facebook group into Kantorek by hand
// (Partytura → Kantorek (feed) → History from Facebook). The form clears after
// each post, so many can be added in a row. Imports never send push.
import { useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, View, useWindowDimensions } from "react-native";

import { tr } from "../i18n";
import { textStyles } from "../theme/text";
import { colors, themedStyles } from "../theme/theme";
import { tokens } from "../theme/tokens";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
import { TextField } from "../ui/TextField";
import { MAX_ATTACHMENTS, importFacebookPost, pickFiles, prepareFile, type NewAttachment } from "./feedApi";

const TZ = "Europe/Warsaw";
const DATE_PATTERN = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?$/;

// "10.10.2026 18:40" (Warsaw time) → ISO with the right offset; null if invalid.
export function parseWarsawDate(text: string): string | null {
  const match = text.trim().match(DATE_PATTERN);
  if (!match) {
    return null;
  }
  const [, day, month, year, hour = "12", minute = "00"] = match;
  const asUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const check = new Date(asUtc);
  if (check.getUTCDate() !== Number(day) || check.getUTCMonth() !== Number(month) - 1 || Number(hour) > 23) {
    return null;
  }
  const offsetLabel =
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" })
      .formatToParts(new Date(asUtc))
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT+1";
  const offset = offsetLabel.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const minutes = offset ? (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3] ?? 0)) : 60;
  return new Date(asUtc - minutes * 60_000).toISOString();
}

type CommentDraft = { authorName: string; body: string; date: string };
type OptionDraft = { label: string; votes: string };

const emptyComment = (): CommentDraft => ({ authorName: "", body: "", date: "" });

export function FeedImportScreen({ onBack, onOpenPost }: { onBack: () => void; onOpenPost: (postId: string) => void }) {
  const { width } = useWindowDimensions();
  const [author, setAuthor] = useState("");
  const [date, setDate] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [likes, setLikes] = useState("");
  const [files, setFiles] = useState<NewAttachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [multiple, setMultiple] = useState(false);
  const [options, setOptions] = useState<OptionDraft[]>([
    { label: "", votes: "" },
    { label: "", votes: "" },
  ]);
  const [comments, setComments] = useState<CommentDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; label: string } | null>(null);

  function reset() {
    setBody("");
    setUrl("");
    setLikes("");
    setFiles([]);
    setPollOpen(false);
    setQuestion("");
    setMultiple(false);
    setOptions([
      { label: "", votes: "" },
      { label: "", votes: "" },
    ]);
    setComments([]);
    // Author and date stay: the next post is often by the same person, nearby in time.
  }

  async function addFiles() {
    setError(null);
    const picked = await pickFiles();
    const room = MAX_ATTACHMENTS - files.length;
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

  async function save() {
    setError(null);
    setAdded(null);
    const createdAt = parseWarsawDate(date);
    if (!author.trim()) {
      setError(tr("Podaj autora wpisu.", "Enter the author."));
      return;
    }
    if (!createdAt) {
      setError(tr("Data w formacie 10.10.2026 18:40.", "Date as 10.10.2026 18:40."));
      return;
    }
    const pollOptions = options
      .map((option) => ({ label: option.label.trim(), votes: Math.max(0, Number.parseInt(option.votes, 10) || 0) }))
      .filter((option) => option.label);
    if (pollOpen && (!question.trim() || pollOptions.length < 2)) {
      setError(tr("Ankieta potrzebuje pytania i co najmniej 2 odpowiedzi.", "A poll needs a question and 2 options."));
      return;
    }
    const commentRows = comments.filter((comment) => comment.body.trim());
    for (const comment of commentRows) {
      if (comment.date.trim() && !parseWarsawDate(comment.date)) {
        setError(tr(`Zła data komentarza: „${comment.date}”.`, `Bad comment date: "${comment.date}".`));
        return;
      }
    }
    setSaving(true);
    try {
      const id = await importFacebookPost(
        {
          authorName: author.trim(),
          createdAt,
          body,
          externalUrl: url.trim() || null,
          likeCount: Math.max(0, Number.parseInt(likes, 10) || 0),
          poll: pollOpen ? { question: question.trim(), multiple, options: pollOptions } : null,
          comments: commentRows.map((comment) => ({
            authorName: comment.authorName.trim(),
            body: comment.body.trim(),
            createdAt: comment.date.trim() ? parseWarsawDate(comment.date) : null,
          })),
        },
        files,
      );
      setAdded({ id, label: `${author.trim()}, ${date.trim()}` });
      reset();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, width >= tokens.breakpoints.desktop && styles.contentDesktop]}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={onBack} accessibilityRole="button" style={styles.back} hitSlop={8}>
        <Icon name="chevronLeft" size={20} color={colors.ink} />
        <Text style={styles.backLabel}>{tr("Kantorek", "Kantorek")}</Text>
      </Pressable>
      <Text style={styles.title}>{tr("Import z Facebooka", "Import from Facebook")}</Text>

      {added ? (
        <View style={styles.addedRow}>
          <Notice tone="success">{tr(`Dodano wpis: ${added.label}.`, `Added: ${added.label}.`)}</Notice>
          <Pressable onPress={() => onOpenPost(added.id)} accessibilityRole="link" style={styles.textAction}>
            <Text style={styles.textActionLabel}>{tr("Zobacz wpis", "See the post")}</Text>
          </Pressable>
        </View>
      ) : null}

      <Card>
        <TextField label={tr("Autor", "Author")} value={author} onChangeText={setAuthor} placeholder="Ania Raczkowska" maxLength={120} />
        <TextField
          label={tr("Data", "Date")}
          value={date}
          onChangeText={setDate}
          placeholder="21.10.2026 18:40"
          hint={tr("Godzina jest opcjonalna.", "The time is optional.")}
        />
        <TextField
          label={tr("Treść", "Text")}
          value={body}
          onChangeText={setBody}
          multiline
          numberOfLines={8}
          maxLength={5000}
          hint={tr("Na Facebooku najpierw rozwiń „Zobacz więcej”.", "On Facebook, expand “See more” first.")}
        />
        <TextField
          label={tr("Link do wpisu na Facebooku (opcjonalnie)", "Link to the Facebook post (optional)")}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          keyboardType="url"
        />
        <TextField
          label={tr("Polubienia", "Likes")}
          value={likes}
          onChangeText={(text) => setLikes(text.replace(/[^0-9]/g, ""))}
          keyboardType="number-pad"
          placeholder="0"
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
              style={styles.textAction}
            >
              <Text style={styles.textActionDanger}>{tr("Usuń", "Remove")}</Text>
            </Pressable>
          </View>
        ))}
        {Platform.OS === "web" && files.length < MAX_ATTACHMENTS ? (
          <Pressable onPress={() => void addFiles()} accessibilityRole="button" style={styles.tool} disabled={preparing}>
            <Icon name="image" size={20} color={colors.ink} />
            <Text style={styles.toolLabel}>
              {preparing ? tr("Przygotowuję…", "Preparing…") : tr("Dodaj zdjęcie lub plik", "Add photo or file")}
            </Text>
          </Pressable>
        ) : null}
      </Card>

      <Card>
        <View style={styles.switchRow}>
          <Text style={styles.sectionTitle}>{tr("Ankieta", "Poll")}</Text>
          <Switch
            value={pollOpen}
            onValueChange={setPollOpen}
            trackColor={{ true: colors.brand, false: colors.controlBorder }}
            accessibilityLabel={tr("Wpis ma ankietę", "The post has a poll")}
          />
        </View>
        {pollOpen ? (
          <>
            <TextField label={tr("Pytanie", "Question")} value={question} onChangeText={setQuestion} maxLength={300} />
            {options.map((option, index) => (
              <View key={index} style={styles.optionRow}>
                <TextField
                  value={option.label}
                  onChangeText={(text) =>
                    setOptions((current) => current.map((value, at) => (at === index ? { ...value, label: text } : value)))
                  }
                  placeholder={tr(`Odpowiedź ${index + 1}`, `Option ${index + 1}`)}
                  accessibilityLabel={tr(`Odpowiedź ${index + 1}`, `Option ${index + 1}`)}
                  style={styles.optionLabel}
                />
                <TextField
                  value={option.votes}
                  onChangeText={(text) =>
                    setOptions((current) =>
                      current.map((value, at) => (at === index ? { ...value, votes: text.replace(/[^0-9]/g, "") } : value)),
                    )
                  }
                  placeholder={tr("głosy", "votes")}
                  accessibilityLabel={tr(`Głosy na odpowiedź ${index + 1}`, `Votes for option ${index + 1}`)}
                  keyboardType="number-pad"
                  style={styles.optionVotes}
                />
              </View>
            ))}
            {options.length < 10 ? (
              <Pressable
                onPress={() => setOptions((current) => [...current, { label: "", votes: "" }])}
                accessibilityRole="button"
                style={styles.textAction}
              >
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
          </>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>{tr("Komentarze", "Comments")}</Text>
        {comments.map((comment, index) => (
          <View key={index} style={styles.commentDraft}>
            <TextField
              label={tr(`Komentarz ${index + 1}: autor`, `Comment ${index + 1}: author`)}
              value={comment.authorName}
              onChangeText={(text) =>
                setComments((current) => current.map((value, at) => (at === index ? { ...value, authorName: text } : value)))
              }
            />
            <TextField
              label={tr("Treść", "Text")}
              value={comment.body}
              onChangeText={(text) =>
                setComments((current) => current.map((value, at) => (at === index ? { ...value, body: text } : value)))
              }
              multiline
              numberOfLines={3}
            />
            <TextField
              label={tr("Data (opcjonalnie)", "Date (optional)")}
              value={comment.date}
              onChangeText={(text) =>
                setComments((current) => current.map((value, at) => (at === index ? { ...value, date: text } : value)))
              }
              placeholder="21.10.2026 19:05"
            />
            <Pressable
              onPress={() => setComments((current) => current.filter((_, at) => at !== index))}
              accessibilityRole="button"
              style={styles.textAction}
            >
              <Text style={styles.textActionDanger}>{tr("Usuń komentarz", "Remove comment")}</Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          onPress={() => setComments((current) => [...current, emptyComment()])}
          accessibilityRole="button"
          style={styles.textAction}
        >
          <Text style={styles.textActionLabel}>{tr("Dodaj komentarz", "Add comment")}</Text>
        </Pressable>
      </Card>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button
        label={tr("Dodaj do Kantorka", "Add to Kantorek")}
        size="lg"
        onPress={() => void save()}
        loading={saving}
        disabled={preparing}
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
  title: textStyles.pageTitle,
  sectionTitle: textStyles.sectionTitle,
  addedRow: {
    gap: 4,
  },
  textAction: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
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
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.sm,
  },
  fileName: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
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
  optionRow: {
    flexDirection: "row",
    gap: tokens.spacing.sm,
  },
  optionLabel: {
    flex: 1,
  },
  optionVotes: {
    width: 88,
  },
  commentDraft: {
    gap: tokens.spacing.xs,
    paddingBottom: tokens.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceMuted,
  },
}));
