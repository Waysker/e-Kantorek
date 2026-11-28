// Kantorek feed (Partytura → Patterns → Kantorek (feed)): reads and writes
// through the RPCs of migration 035; files go to the private Storage bucket
// "feed" under "<user id>/<random>/<name>" and are shown via signed URLs.
import { supabaseAuthClient } from "../auth/supabaseAuthClient";

export type FeedAttachment = {
  id: string;
  path: string;
  kind: "image" | "file";
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  /** Signed URL, filled by withSignedUrls. */
  url?: string;
};

export type FeedPollOption = { id: string; label: string; votes: number; mine: boolean };
export type FeedPoll = {
  question: string;
  multiple: boolean;
  /** Imported from Facebook: results only. */
  closed?: boolean;
  voterCount: number;
  options: FeedPollOption[];
};

export type FeedPost = {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  pinned: boolean;
  mine: boolean;
  /** "facebook": copied from the FB group (migration 037). */
  source?: "app" | "facebook";
  externalUrl?: string | null;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  attachments: FeedAttachment[];
  poll: FeedPoll | null;
};

export type FeedComment = {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  mine: boolean;
};

/** A file picked in the composer, already shrunk if it was a photo. */
export type NewAttachment = {
  blob: Blob;
  fileName: string;
  mimeType: string;
  kind: "image" | "file";
  width?: number;
  height?: number;
};

export type NewPoll = { question: string; multiple: boolean; options: string[] };

const BUCKET = "feed";
const SIGNED_URL_SECONDS = 60 * 60;
export const MAX_ATTACHMENTS = 6;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PHOTO_MAX_SIDE = 1600;

function client() {
  if (!supabaseAuthClient) {
    throw new Error("Brak połączenia z serwerem.");
  }
  return supabaseAuthClient;
}

function fail(error: { message?: string } | null, fallback: string): never {
  console.warn("[feed]", error);
  throw new Error(fallback);
}

async function withSignedUrls(posts: FeedPost[]): Promise<FeedPost[]> {
  const paths = posts.flatMap((post) => post.attachments.map((attachment) => attachment.path));
  if (paths.length === 0) {
    return posts;
  }
  const { data, error } = await client().storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error || !data) {
    console.warn("[feed] signed urls", error);
    return posts;
  }
  const urlByPath = new Map(data.map((entry) => [entry.path, entry.signedUrl]));
  return posts.map((post) => ({
    ...post,
    attachments: post.attachments.map((attachment) => ({
      ...attachment,
      url: urlByPath.get(attachment.path) ?? undefined,
    })),
  }));
}

export async function listFeed(before?: string): Promise<FeedPost[]> {
  const { data, error } = await client().rpc("list_feed", { p_limit: 20, p_before: before ?? null });
  if (error) {
    fail(error, "Nie udało się wczytać Kantorka.");
  }
  return withSignedUrls((data ?? []) as FeedPost[]);
}

export async function getPost(postId: string): Promise<{ post: FeedPost | null; comments: FeedComment[] }> {
  const { data, error } = await client().rpc("get_feed_post", { p_post_id: postId });
  if (error) {
    fail(error, "Nie udało się wczytać wpisu.");
  }
  const result = (data ?? {}) as { post: FeedPost | null; comments: FeedComment[] | null };
  const [post] = result.post ? await withSignedUrls([result.post]) : [null];
  return { post: post ?? null, comments: result.comments ?? [] };
}

function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (cleaned || "plik").slice(-80);
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export async function createPost(body: string, attachments: NewAttachment[], poll: NewPoll | null): Promise<string> {
  const supabase = client();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) {
    throw new Error("Zaloguj się ponownie.");
  }

  const uploaded: string[] = [];
  const described = [];
  try {
    for (const attachment of attachments) {
      const path = `${uid}/${randomId()}/${safeFileName(attachment.fileName)}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, attachment.blob, {
        contentType: attachment.mimeType,
        upsert: false,
      });
      if (error) {
        fail(error, `Nie udało się wysłać pliku „${attachment.fileName}”.`);
      }
      uploaded.push(path);
      described.push({
        path,
        kind: attachment.kind,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.blob.size,
        width: attachment.width ?? null,
        height: attachment.height ?? null,
      });
    }

    const { data, error } = await supabase.rpc("create_feed_post", {
      p_body: body,
      p_poll: poll,
      p_attachments: described,
    });
    if (error) {
      fail(error, "Nie udało się opublikować wpisu.");
    }
    return data as string;
  } catch (error) {
    if (uploaded.length > 0) {
      await supabase.storage.from(BUCKET).remove(uploaded);
    }
    throw error;
  }
}

export type FeedMember = { id: string; fullName: string };

/** Board/admin: confirmed accounts, for linking imported posts. */
export async function listMembers(): Promise<FeedMember[]> {
  const { data, error } = await client().rpc("feed_list_members");
  if (error) {
    fail(error, "Nie udało się wczytać listy kont.");
  }
  return ((data ?? []) as Array<{ id: string; full_name: string }>).map((row) => ({
    id: row.id,
    fullName: row.full_name,
  }));
}

/** Board/admin: link an imported post to an account, or unlink (null). */
export async function setAuthor(postId: string, profileId: string | null) {
  const { error } = await client().rpc("set_feed_author", { p_post_id: postId, p_profile_id: profileId });
  if (error) {
    fail(error, "Nie udało się zmienić autora.");
  }
}

export type FacebookImport = {
  authorName: string;
  authorProfileId: string | null;
  createdAt: string;
  body: string;
  externalUrl: string | null;
  likeCount: number;
  poll: { question: string; multiple: boolean; options: Array<{ label: string; votes: number }> } | null;
  comments: Array<{ authorName: string; authorProfileId: string | null; body: string; createdAt: string | null }>;
};

async function uploadAll(attachments: NewAttachment[]) {
  const supabase = client();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) {
    throw new Error("Zaloguj się ponownie.");
  }
  const uploaded: string[] = [];
  const described = [];
  try {
    for (const attachment of attachments) {
      const path = `${uid}/${randomId()}/${safeFileName(attachment.fileName)}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, attachment.blob, {
        contentType: attachment.mimeType,
        upsert: false,
      });
      if (error) {
        fail(error, `Nie udało się wysłać pliku „${attachment.fileName}”.`);
      }
      uploaded.push(path);
      described.push({
        path,
        kind: attachment.kind,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.blob.size,
        width: attachment.width ?? null,
        height: attachment.height ?? null,
      });
    }
  } catch (error) {
    if (uploaded.length > 0) {
      await supabase.storage.from(BUCKET).remove(uploaded);
    }
    throw error;
  }
  return { uploaded, described };
}

/** Board/admin: copies one Facebook post over (no push). */
export async function importFacebookPost(post: FacebookImport, attachments: NewAttachment[]): Promise<string> {
  const { uploaded, described } = await uploadAll(attachments);
  const { data, error } = await client().rpc("import_feed_post", { p: { ...post, attachments: described } });
  if (error) {
    if (uploaded.length > 0) {
      await client().storage.from(BUCKET).remove(uploaded);
    }
    fail(error, "Nie udało się dodać wpisu.");
  }
  return data as string;
}

export async function updatePost(postId: string, body: string) {
  const { error } = await client().rpc("update_feed_post", { p_post_id: postId, p_body: body });
  if (error) {
    fail(error, "Nie udało się zapisać zmian.");
  }
}

export async function deletePost(postId: string) {
  const { data, error } = await client().rpc("delete_feed_post", { p_post_id: postId });
  if (error) {
    fail(error, "Nie udało się usunąć wpisu.");
  }
  // Own files only (Storage policy); the board's deletions leave the files.
  const paths = (data ?? []) as string[];
  if (paths.length > 0) {
    await client().storage.from(BUCKET).remove(paths);
  }
}

export async function setPinned(postId: string, pinned: boolean) {
  const { error } = await client().rpc("set_feed_post_pinned", { p_post_id: postId, p_pinned: pinned });
  if (error) {
    fail(error, pinned ? "Nie udało się przypiąć wpisu." : "Nie udało się odpiąć wpisu.");
  }
}

export async function toggleLike(postId: string): Promise<boolean> {
  const { data, error } = await client().rpc("toggle_feed_reaction", { p_post_id: postId });
  if (error) {
    fail(error, "Nie udało się zapisać polubienia.");
  }
  return Boolean(data);
}

export async function vote(postId: string, optionIds: string[]) {
  const { error } = await client().rpc("vote_feed_poll", { p_post_id: postId, p_option_ids: optionIds });
  if (error) {
    fail(error, "Nie udało się zapisać głosu.");
  }
}

export async function addComment(postId: string, body: string) {
  const { error } = await client().rpc("add_feed_comment", { p_post_id: postId, p_body: body });
  if (error) {
    fail(error, "Nie udało się dodać komentarza.");
  }
}

export async function updateComment(commentId: string, body: string) {
  const { error } = await client().rpc("update_feed_comment", { p_comment_id: commentId, p_body: body });
  if (error) {
    fail(error, "Nie udało się zapisać komentarza.");
  }
}

export async function deleteComment(commentId: string) {
  const { error } = await client().rpc("delete_feed_comment", { p_comment_id: commentId });
  if (error) {
    fail(error, "Nie udało się usunąć komentarza.");
  }
}

/** Who liked the post (optionId null) or voted for an option. */
export async function listPeople(postId: string, optionId: string | null): Promise<string[]> {
  const { data, error } = await client().rpc("feed_people", { p_post_id: postId, p_option_id: optionId });
  if (error) {
    fail(error, "Nie udało się wczytać listy osób.");
  }
  return ((data ?? []) as Array<{ full_name: string }>).map((row) => row.full_name);
}

// ---------------------------------------------------------------- picking files (web)

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    image.src = url;
  });
}

// Photos shrink to PHOTO_MAX_SIDE as JPEG (GIFs stay as they are, to keep
// animation); other files go as they are, up to MAX_FILE_BYTES.
export async function prepareFile(file: File): Promise<NewAttachment> {
  const isImage = file.type.startsWith("image/");
  if (isImage && file.type !== "image/gif") {
    try {
      const image = await readImage(file);
      const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.round(image.naturalWidth * scale);
      const height = Math.round(image.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (blob) {
        return {
          blob,
          fileName: file.name.replace(/\.[^.]+$/, "") + ".jpg",
          mimeType: "image/jpeg",
          kind: "image",
          width,
          height,
        };
      }
    } catch {
      // Fall through: send the original.
    }
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`„${file.name}” ma więcej niż 10 MB.`);
  }
  return {
    blob: file,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    kind: isImage ? "image" : "file",
  };
}

/** Opens the browser's file picker (web only). */
export function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,.pdf,.xlsx,.xls,.docx,.doc,.txt";
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}
