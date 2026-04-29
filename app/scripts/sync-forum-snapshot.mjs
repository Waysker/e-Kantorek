import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(APP_ROOT, ".cache", "forum-sync");
const CONFIG_PATH = path.join(APP_ROOT, "forum-sync.config.json");
const OVERRIDES_PATH = path.join(APP_ROOT, "forum-sync.instrument-overrides.json");
const OVERRIDES_EXAMPLE_PATH = path.join(APP_ROOT, "forum-sync.instrument-overrides.example.json");
const ENV_PATHS = [
  path.join(APP_ROOT, ".env.local"),
  path.join(APP_ROOT, ".env"),
];
const FORUM_OVERRIDES_TABLE = "forum_instrument_overrides";
const SNAPSHOT_PATH = path.join(APP_ROOT, "src", "data", "generated", "forumSnapshot.ts");
const DEFAULT_CONFIG = {
  baseUrl: "https://www.oragh.agh.edu.pl/forum",
  memberListPath: "/memberlist.php",
  concertForumPath: "/forumdisplay.php?fid=27",
  concertForumPaths: ["/forumdisplay.php?fid=27", "/forumdisplay.php?fid=50"],
  eventThreadUrls: [],
  maxThreads: 24,
  eventYear: Number.parseInt(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric" }).format(new Date()), 10),
};
const FALLBACK_EVENT_HOUR = 19;
const FALLBACK_EVENT_MINUTE = 0;
const UNKNOWN_INSTRUMENT_LABEL = "Instrument not mapped yet";
const CANONICAL_INSTRUMENT_LABEL_BY_KEY = {
  flet: "Flety",
  flety: "Flety",
  oboj: "Oboje",
  oboje: "Oboje",
  klarnet: "Klarnety",
  klarnety: "Klarnety",
  fagot: "Fagoty",
  fagoty: "Fagoty",
  saksofon: "Saksofony",
  saksofony: "Saksofony",
  waltornia: "Waltornie",
  waltornie: "Waltornie",
  trabka: "Trąbki",
  trabki: "Trąbki",
  puzon: "Puzony",
  puzony: "Puzony",
  tuba: "Tuby",
  tuby: "Tuby",
  eufonia: "Eufonia",
  eufonie: "Eufonia",
  perkusja: "Perkusja",
  gitara: "Gitary",
  gitary: "Gitary",
  bas: "Gitary",
  basy: "Gitary",
};

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  absorb(response) {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";", 1);
      const splitIndex = pair.indexOf("=");
      if (splitIndex <= 0) {
        continue;
      }
      this.cookies.set(pair.slice(0, splitIndex).trim(), pair.slice(splitIndex + 1).trim());
    }
  }

  headerValue() {
    return Array.from(this.cookies.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

const POLISH_MOJIBAKE_REPLACEMENTS = [
  ["Ä…", "ą"],
  ["Ä„", "Ą"],
  ["Ä‡", "ć"],
  ["Ä†", "Ć"],
  ["Ä™", "ę"],
  ["Ä˜", "Ę"],
  ["Å‚", "ł"],
  ["Å\u0081", "Ł"],
  ["Å„", "ń"],
  ["Åƒ", "Ń"],
  ["Ã³", "ó"],
  ["Ã“", "Ó"],
  ["Å›", "ś"],
  ["Åš", "Ś"],
  ["Åº", "ź"],
  ["Å¹", "Ź"],
  ["Å¼", "ż"],
  ["Å»", "Ż"],
];

function repairPolishMojibake(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  let repaired = value;
  for (const [from, to] of POLISH_MOJIBAKE_REPLACEMENTS) {
    repaired = repaired.replaceAll(from, to);
  }

  return repaired;
}

function normalizeMultilineText(value) {
  return value.replace(/\r/g, "").split("\n").map((line) => normalizeWhitespace(line)).filter(Boolean).join("\n");
}

function stripDiacritics(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeInstrumentKey(value) {
  return stripDiacritics(normalizeWhitespace(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalizeInstrumentLabel(value, fallbackLabel = UNKNOWN_INSTRUMENT_LABEL) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return fallbackLabel;
  }

  return CANONICAL_INSTRUMENT_LABEL_BY_KEY[normalizeInstrumentKey(normalized)] ?? normalized;
}

function sanitizeFileName(value) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function slugify(value) {
  return sanitizeFileName(stripDiacritics(value).toLowerCase());
}

function resolveUrl(baseUrl, value) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(value.replace(/^\//, ""), normalizedBase).toString();
}

function decodeHtml(buffer, preferredEncoding) {
  try {
    return new TextDecoder(preferredEncoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function looksMojibake(value) {
  return value.includes("Å") || value.includes("Ä") || value.includes("Ã") || value.includes("�");
}

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const splitIndex = trimmed.indexOf("=");
      if (splitIndex <= 0) {
        continue;
      }
      const key = trimmed.slice(0, splitIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      let value = trimmed.slice(splitIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

async function loadEnv() {
  for (const envPath of ENV_PATHS) {
    await loadEnvFile(envPath);
  }
}

function normalizeOverridesShape(value) {
  const parsed = toObject(value);
  return {
    byUid: toObject(parsed.byUid),
    byFullName: toObject(parsed.byFullName),
    byUsername: toObject(parsed.byUsername),
  };
}

function countOverrideEntries(overrides) {
  return (
    Object.keys(overrides.byUid).length +
    Object.keys(overrides.byFullName).length +
    Object.keys(overrides.byUsername).length
  );
}

function resolveOverridesKey() {
  return process.env.ORAGH_INSTRUMENT_OVERRIDES_KEY?.trim() ?? process.env.ORAGH_SNAPSHOT_KEY?.trim() ?? "forum";
}

async function readOverridesFromSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const overridesKey = resolveOverridesKey();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const { data, error } = await client
      .from(FORUM_OVERRIDES_TABLE)
      .select("overrides_key,payload")
      .eq("overrides_key", overridesKey)
      .maybeSingle();

    if (error) {
      const normalizedMessage = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
      if (
        normalizedMessage.includes("pgrst205") ||
        normalizedMessage.includes("could not find the table") ||
        normalizedMessage.includes("does not exist")
      ) {
        console.warn(
          `Supabase table '${FORUM_OVERRIDES_TABLE}' is not available yet. Falling back to local/env overrides.`,
        );
        return null;
      }

      throw new Error(`Supabase overrides query failed: ${error.message}`);
    }

    if (!data?.payload) {
      return null;
    }

    return {
      source: `supabase:${FORUM_OVERRIDES_TABLE}:${overridesKey}`,
      overrides: normalizeOverridesShape(data.payload),
    };
  } catch (error) {
    console.warn(
      `Could not fetch overrides from Supabase. Falling back to local/env overrides. (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    return null;
  }
}

async function readConfig() {
  const raw = (await readJson(CONFIG_PATH)) ?? {};
  const configuredForumPaths = Array.isArray(raw.concertForumPaths)
    ? raw.concertForumPaths.filter((value) => typeof value === "string" && value.trim().length > 0)
    : typeof raw.concertForumPath === "string" && raw.concertForumPath.trim().length > 0
      ? [raw.concertForumPath]
      : DEFAULT_CONFIG.concertForumPaths;

  return {
    ...DEFAULT_CONFIG,
    ...raw,
    concertForumPaths: configuredForumPaths.length > 0 ? configuredForumPaths : DEFAULT_CONFIG.concertForumPaths,
    eventThreadUrls: Array.isArray(raw.eventThreadUrls) ? raw.eventThreadUrls : DEFAULT_CONFIG.eventThreadUrls,
    maxThreads: typeof raw.maxThreads === "number" && raw.maxThreads > 0 ? raw.maxThreads : DEFAULT_CONFIG.maxThreads,
    eventYear: typeof raw.eventYear === "number" && raw.eventYear > 0 ? raw.eventYear : DEFAULT_CONFIG.eventYear,
  };
}

async function readOverrides() {
  const envOverridesRaw = readOverridesFromEnv();
  const localOverridesRaw = await readJson(OVERRIDES_PATH);
  const templateOverridesRaw = localOverridesRaw || envOverridesRaw ? null : await readJson(OVERRIDES_EXAMPLE_PATH);
  const envOverrides = normalizeOverridesShape(envOverridesRaw);
  const localOverrides = normalizeOverridesShape(localOverridesRaw);
  const templateOverrides = normalizeOverridesShape(templateOverridesRaw);
  const supabaseOverridesResult = await readOverridesFromSupabase();
  const supabaseOverrides = normalizeOverridesShape(supabaseOverridesResult?.overrides);
  const template = templateOverrides;
  const local = localOverrides;
  const env = envOverrides;
  const supabase = supabaseOverrides;

  const merged = {
    byUid: { ...toObject(template.byUid), ...toObject(local.byUid), ...toObject(env.byUid) },
    byFullName: {
      ...toObject(template.byFullName),
      ...toObject(local.byFullName),
      ...toObject(env.byFullName),
    },
    byUsername: {
      ...toObject(template.byUsername),
      ...toObject(local.byUsername),
      ...toObject(env.byUsername),
    },
  };

  if (supabaseOverridesResult) {
    merged.byUid = { ...merged.byUid, ...toObject(supabase.byUid) };
    merged.byFullName = { ...merged.byFullName, ...toObject(supabase.byFullName) };
    merged.byUsername = { ...merged.byUsername, ...toObject(supabase.byUsername) };
    console.log(
      `Instrument overrides loaded from ${supabaseOverridesResult.source} (${countOverrideEntries(supabaseOverrides)} entries).`,
    );
  } else {
    console.log(
      `Instrument overrides loaded from local/env sources (${countOverrideEntries(merged)} entries).`,
    );
  }

  return merged;
}

function readOverridesFromEnv() {
  const raw = process.env.ORAGH_FORUM_INSTRUMENT_OVERRIDES_JSON;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      byUid: toObject(parsed.byUid),
      byFullName: toObject(parsed.byFullName),
      byUsername: toObject(parsed.byUsername),
    };
  } catch {
    throw new Error(
      "ORAGH_FORUM_INSTRUMENT_OVERRIDES_JSON is not valid JSON. It must contain { byUid, byFullName, byUsername } objects.",
    );
  }
}

async function requestHtml({ jar, url, method = "GET", body }) {
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;

  for (let redirectCount = 0; redirectCount < 10; redirectCount += 1) {
    const headers = {
      "user-agent": "ORAGH Prototype Sync/0.2",
      accept: "text/html,application/xhtml+xml",
    };
    const cookieHeader = jar.headerValue();
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }
    if (currentBody) {
      headers["content-type"] = "application/x-www-form-urlencoded";
    }

    const response = await fetch(currentUrl, {
      method: currentMethod,
      headers,
      body: currentBody,
      redirect: "manual",
    });
    jar.absorb(response);

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get("location")
    ) {
      currentUrl = resolveUrl(currentUrl, response.headers.get("location"));
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          currentMethod !== "GET" &&
          currentMethod !== "HEAD")
      ) {
        currentMethod = "GET";
        currentBody = undefined;
      }
      continue;
    }

    if (!response.ok) {
      throw new Error(`Request failed for ${currentUrl}: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    const headerCharset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase() ?? "utf-8";
    const utf8Html = decodeHtml(buffer, "utf-8");
    let html = /charset\s*=\s*["']?utf-8/i.test(utf8Html)
      ? utf8Html
      : decodeHtml(buffer, headerCharset);

    if (looksMojibake(html)) {
      const fallback = decodeHtml(buffer, "windows-1250");
      if (!looksMojibake(fallback)) {
        html = fallback;
      }
    }

    return { url: response.url || currentUrl, html };
  }

  throw new Error(`Too many redirects while requesting ${url}`);
}

async function saveCacheFile(name, content) {
  await ensureCacheDir();
  const filePath = path.join(CACHE_DIR, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function loginToForum(baseUrl, username, password) {
  const jar = new CookieJar();
  const loginPage = await requestHtml({ jar, url: resolveUrl(baseUrl, "/member.php?action=login") });
  const $ = load(loginPage.html);
  const myPostKey = $('input[name="my_post_key"]').attr("value")?.trim() ?? "";
  if (!myPostKey) {
    throw new Error("Could not find my_post_key on the forum login page.");
  }
  const body = new URLSearchParams({
    action: "do_login",
    url: "",
    quick_login: "1",
    quick_username: username,
    quick_password: password,
    quick_remember: "yes",
    my_post_key: myPostKey,
    submit: "Zaloguj się",
  });
  await requestHtml({ jar, url: resolveUrl(baseUrl, "/member.php"), method: "POST", body });
  const homePage = await requestHtml({ jar, url: resolveUrl(baseUrl, "/index.php") });
  if (homePage.html.includes("quick_login_username") || homePage.html.includes("Nie nast")) {
    throw new Error("Forum login did not stick. Check the credentials and account permissions.");
  }
  await saveCacheFile("home.html", homePage.html);
  return jar;
}

function extractThreadTitle(html) {
  const title = load(html)("title").text().trim();
  return normalizeWhitespace(title.split(" - ")[0] ?? title);
}

function extractTitleYear(title) {
  const match = /^(\d{4})\./.exec(title);
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseDateFromTitle(title) {
  const preciseMatch = /(\d{4})\.(\d{2})\.(\d{2})/.exec(title);
  if (preciseMatch) {
    return {
      year: Number.parseInt(preciseMatch[1], 10),
      month: Number.parseInt(preciseMatch[2], 10),
      day: Number.parseInt(preciseMatch[3], 10),
    };
  }

  const monthOnlyMatch = /^(\d{4})\.(\d{2})\/\d{2}\./.exec(title);
  return monthOnlyMatch
    ? { year: Number.parseInt(monthOnlyMatch[1], 10), month: Number.parseInt(monthOnlyMatch[2], 10), day: 1 }
    : null;
}

function getForumCacheKey(baseUrl, forumPath) {
  const resolvedUrl = new URL(resolveUrl(baseUrl, forumPath));
  const forumId = resolvedUrl.searchParams.get("fid");
  return forumId ? `fid-${forumId}` : sanitizeFileName(resolvedUrl.pathname);
}

function extractForumPageNumbers(html, baseUrl, forumPath) {
  const resolvedForumUrl = new URL(resolveUrl(baseUrl, forumPath));
  const expectedForumId = resolvedForumUrl.searchParams.get("fid");
  const pages = new Set([1]);
  const $ = load(html);

  $('a[href*="forumdisplay.php?"]').each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    const candidateUrl = new URL(resolveUrl(baseUrl, href));
    if (candidateUrl.searchParams.get("fid") !== expectedForumId) {
      return;
    }

    const page = Number.parseInt(candidateUrl.searchParams.get("page") ?? "1", 10);
    if (Number.isInteger(page) && page > 1) {
      pages.add(page);
    }
  });

  return Array.from(pages).sort((left, right) => left - right);
}

function discoverConcertThreads(html, baseUrl, { eventYear, seenThreadIds = new Set() } = {}) {
  const $ = load(html);
  const threads = [];
  const elements = $('span[id^="tid_"] > a[href*="showthread.php?tid="], a[href*="showthread.php?tid="][title]');

  elements.each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }
    const resolved = resolveUrl(baseUrl, href);
    const url = new URL(resolved);
    const threadId = url.searchParams.get("tid");
    if (!threadId || seenThreadIds.has(threadId) || url.searchParams.has("pid")) {
      return;
    }
    const title = normalizeWhitespace($(element).attr("title") || $(element).text());
    const titleYear = extractTitleYear(title);
    if (titleYear === null || (typeof eventYear === "number" && titleYear !== eventYear)) {
      return;
    }
    seenThreadIds.add(threadId);
    threads.push({ threadId, url: `${url.origin}${url.pathname}?tid=${threadId}`, title });
  });

  return threads;
}

async function discoverConcertThreadsFromForums({ jar, baseUrl, forumPaths, eventYear, maxThreads }) {
  const seenThreadIds = new Set();
  const discovered = [];
  const forumPages = [];

  for (const forumPath of forumPaths) {
    const resolvedForumUrl = resolveUrl(baseUrl, forumPath);
    const forumCacheKey = getForumCacheKey(baseUrl, forumPath);
    const firstPage = await requestHtml({ jar, url: resolvedForumUrl });
    const firstCachePath = await saveCacheFile(`forums/${forumCacheKey}-page-1.html`, firstPage.html);
    const pageNumbers = extractForumPageNumbers(firstPage.html, baseUrl, forumPath);
    const cachePaths = [firstCachePath];
    const pages = new Map([[1, firstPage.html]]);

    for (const pageNumber of pageNumbers) {
      if (pageNumber === 1) {
        continue;
      }

      const pageUrl = new URL(resolvedForumUrl);
      pageUrl.searchParams.set("page", String(pageNumber));
      const page = await requestHtml({ jar, url: pageUrl.toString() });
      pages.set(pageNumber, page.html);
      cachePaths.push(await saveCacheFile(`forums/${forumCacheKey}-page-${pageNumber}.html`, page.html));
    }

    forumPages.push({ url: resolvedForumUrl, cachePaths });

    for (const pageNumber of Array.from(pages.keys()).sort((left, right) => left - right)) {
      const threads = discoverConcertThreads(pages.get(pageNumber), baseUrl, { eventYear, seenThreadIds });
      for (const thread of threads) {
        discovered.push({ ...thread, sourceForumUrl: resolvedForumUrl, sourcePage: pageNumber });
        if (discovered.length >= maxThreads) {
          return { threads: discovered, forumPages };
        }
      }
    }
  }

  return { threads: discovered, forumPages };
}

function formatOffset(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Warsaw", timeZoneName: "shortOffset" }).formatToParts(date);
  const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+1";
  const match = /GMT([+-]\d{1,2})(?::?(\d{2}))?/.exec(value);
  if (!match) {
    return "+01:00";
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  return `${hours >= 0 ? "+" : "-"}${String(Math.abs(hours)).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function toWarsawIso(parts) {
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:00${formatOffset(probe)}`;
}

function parseForumTimestamp(value, fallbackDateParts) {
  const match = /(\d{2})-(\d{2})-(\d{4}),\s*(\d{1,2}):(\d{2})/.exec(value);
  if (match) {
    return toWarsawIso({
      day: Number.parseInt(match[1], 10),
      month: Number.parseInt(match[2], 10),
      year: Number.parseInt(match[3], 10),
      hour: Number.parseInt(match[4], 10),
      minute: Number.parseInt(match[5], 10),
    });
  }
  if (fallbackDateParts) {
    return toWarsawIso({ ...fallbackDateParts, hour: FALLBACK_EVENT_HOUR, minute: FALLBACK_EVENT_MINUTE });
  }
  return new Date().toISOString();
}

function htmlToMultilineText(html) {
  const normalizedHtml = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n");

  return normalizeMultilineText(load(`<div>${normalizedHtml}</div>`).text());
}

function parseThreadPage(html, resolvedUrl, baseUrl) {
  const $ = load(html);
  const title = extractThreadTitle(html);
  const threadId = new URL(resolvedUrl).searchParams.get("tid") ?? slugify(title);
  const titleDate = parseDateFromTitle(title);
  const posts = [];
  const seenPostIds = new Set();
  const postContainers = $(
    [
      '[id^="post_"]',
      '[id^="pid_"]',
      'div.post',
      'tr.post',
      'table[id*="post_"]',
      'table[id*="pid_"]',
    ].join(", "),
  );

  postContainers.each((_, element) => {
    const elementId = normalizeWhitespace($(element).attr("id") ?? "");
    const postIdMatch =
      elementId.match(/(?:^|[-_])post_?(\d+)$/i) ??
      elementId.match(/(?:^|[-_])pid_?(\d+)$/i);
    const anchorPostId = $(element).find('a[name^="pid"], a[id^="pid"]').first().attr("name")
      ?.replace(/^pid/i, "")
      ?? $(element).find('a[name^="pid"], a[id^="pid"]').first().attr("id")?.replace(/^pid/i, "")
      ?? null;
    const postId = normalizeWhitespace(postIdMatch?.[1] ?? anchorPostId ?? "");

    if (!postId || seenPostIds.has(postId)) {
      return;
    }
    if (elementId.startsWith("post_meta_")) {
      return;
    }

    const bodyHtml = $(element)
      .find(
        [
          ".post_body",
          ".post_body.scaleimages",
          ".post_content",
          ".post_message",
          'div[id^="pid_"]',
          'td[id^="pid_"]',
        ].join(", "),
      )
      .first()
      .html()
      ?? "";
    const bodyText = htmlToMultilineText(bodyHtml);
    if (!bodyText) {
      return;
    }
    const authorLink = $(element)
      .find(
        '.post_author a[href*="member.php?action=profile"], .author_information a[href*="member.php?action=profile"], .author a[href*="member.php?action=profile"], a[href*="member.php?action=profile"]',
      )
      .first();
    const authorUrl = authorLink.attr("href");
    posts.push({
      postId,
      author: {
        uid: authorUrl ? new URL(resolveUrl(baseUrl, authorUrl)).searchParams.get("uid") : null,
        username: normalizeWhitespace(authorLink.text()) || "Unknown member",
      },
      createdAtText: normalizeWhitespace($(element).find(".post_date").first().text()),
      createdAt: parseForumTimestamp(normalizeWhitespace($(element).find(".post_date").first().text()), titleDate),
      bodyText,
    });
    seenPostIds.add(postId);
  });
  const pollResultsUrl = $('a[href*="polls.php?action=showresults"]').first().attr("href");
  return { threadId, title, titleDate, posts, pollResultsUrl: pollResultsUrl ? resolveUrl(baseUrl, pollResultsUrl) : null };
}

function extractThreadPageNumbers(html, baseUrl, threadUrl) {
  const resolvedThreadUrl = new URL(resolveUrl(baseUrl, threadUrl));
  const expectedThreadId = resolvedThreadUrl.searchParams.get("tid");
  const pages = new Set([1]);
  const $ = load(html);

  function parseThreadRef(candidateHref) {
    const resolved = resolveUrl(baseUrl, candidateHref);
    const candidateUrl = new URL(resolved);
    const queryThreadId = candidateUrl.searchParams.get("tid");
    const queryPage = Number.parseInt(candidateUrl.searchParams.get("page") ?? "", 10);
    if (queryThreadId) {
      return {
        threadId: queryThreadId,
        page: Number.isInteger(queryPage) && queryPage > 0 ? queryPage : null,
      };
    }

    const pathMatch = candidateUrl.pathname.match(/thread-(\d+)(?:-page-(\d+))?\.html$/i);
    if (pathMatch) {
      return {
        threadId: pathMatch[1],
        page: pathMatch[2] ? Number.parseInt(pathMatch[2], 10) : 1,
      };
    }

    return { threadId: null, page: null };
  }

  $('a[href]').each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    const { threadId, page } = parseThreadRef(href);
    if (!threadId || !expectedThreadId || threadId !== expectedThreadId) {
      return;
    }
    if (Number.isInteger(page) && page > 1) {
      pages.add(page);
    }
  });

  return Array.from(pages).sort((left, right) => left - right);
}

function mergeAndSortThreadPosts(parsedPages) {
  const byPostId = new Map();
  for (const parsed of parsedPages) {
    for (const post of parsed.posts) {
      if (!byPostId.has(post.postId)) {
        byPostId.set(post.postId, post);
      }
    }
  }

  return Array.from(byPostId.values()).sort((left, right) => {
    const leftPostId = Number.parseInt(left.postId, 10);
    const rightPostId = Number.parseInt(right.postId, 10);
    if (Number.isInteger(leftPostId) && Number.isInteger(rightPostId) && leftPostId !== rightPostId) {
      return leftPostId - rightPostId;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function parsePollResultsPage(html, baseUrl) {
  const $ = load(html);
  const question = normalizeWhitespace($("td.thead strong").first().text().replace(/^Ankieta:\s*/i, ""));
  const options = [];
  $("table.tborder tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) {
      return;
    }
    const label = normalizeWhitespace(cells.eq(0).text()).replace(/\*+$/, "").trim();
    const count = Number.parseInt(normalizeWhitespace(cells.eq(2).text()), 10);
    if (!label || Number.isNaN(count)) {
      return;
    }
    const participants = cells.eq(1).find('a[href*="member.php?action=profile"]').map((_, link) => {
      const href = $(link).attr("href");
      return { uid: href ? new URL(resolveUrl(baseUrl, href)).searchParams.get("uid") : null, username: normalizeWhitespace($(link).text()) };
    }).get();
    options.push({ label, count, percent: Number.parseFloat(normalizeWhitespace(cells.eq(3).text()).replace("%", "")) || 0, participants });
  });
  return { question, options, totalVotes: options.reduce((sum, option) => sum + option.count, 0) };
}

function parseProfilePage(html, participant) {
  const $ = load(html);
  const fields = {};
  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) {
      return;
    }
    const label = stripDiacritics(repairPolishMojibake(cells.eq(0).text())).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const value = normalizeWhitespace(repairPolishMojibake(cells.eq(1).text()));
    if (label && value) {
      fields[label] = value;
    }
  });
  const title = normalizeWhitespace(repairPolishMojibake($("title").text()));
  const titleUsername = title.replace(/^.*Profil:\s*/i, "").split(" - ")[0];
  const username = repairPolishMojibake(participant.username) || normalizeWhitespace(titleUsername);
  const fullName = normalizeWhitespace(`${fields.imie ?? ""} ${fields.nazwisko ?? ""}`) || username;
  return { uid: participant.uid ?? null, username, fullName };
}

function toUserKey(participant) {
  return participant.uid ? `uid:${participant.uid}` : `username:${participant.username.toLowerCase()}`;
}

function normalizeOverrideKey(value) {
  return stripDiacritics(repairPolishMojibake(value)).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeInstrumentValue(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = repairPolishMojibake(value).trim();
  if (!trimmed || trimmed === "-") {
    return undefined;
  }

  return canonicalizeInstrumentLabel(trimmed);
}

function getOverrideValue(map, key) {
  if (!key) {
    return undefined;
  }

  const exact = normalizeInstrumentValue(map[key]);
  if (exact) {
    return exact;
  }

  const normalizedKey = normalizeOverrideKey(key);
  for (const [candidateKey, candidateValue] of Object.entries(map)) {
    if (normalizeOverrideKey(candidateKey) === normalizedKey) {
      return normalizeInstrumentValue(candidateValue);
    }
  }

  return undefined;
}

function applyOverrides(user, overrides) {
  const instrument = normalizeInstrumentValue(
    (user.uid ? overrides.byUid[user.uid] : null) ??
      getOverrideValue(overrides.byFullName, user.fullName) ??
      getOverrideValue(overrides.byUsername, user.username),
  );

  return { ...user, primaryInstrument: instrument };
}

function attendanceStatusFromLabel(label) {
  const normalized = stripDiacritics(label).toLowerCase();
  if (normalized.startsWith("tak")) {
    return "going";
  }
  if (normalized.startsWith("nie")) {
    return "not_going";
  }
  if (normalized.includes("moze")) {
    return "maybe";
  }
  return "no_response";
}

function attendanceLabel(status) {
  if (status === "going") {
    return "Going";
  }
  if (status === "maybe") {
    return "Maybe";
  }
  if (status === "not_going") {
    return "Not going";
  }
  return "No response";
}

function attendanceOptionLabel(status) {
  if (status === "going") {
    return "Going";
  }

  if (status === "maybe") {
    return "Maybe";
  }

  if (status === "not_going") {
    return "Not going";
  }

  return "No response";
}

function extractVenue(description) {
  return description.split("\n").find((line) => /^miejsce:/i.test(stripDiacritics(line)))?.split(":").slice(1).join(":").trim() || undefined;
}

function extractStartClock(description) {
  const match = /godzina:\s*(\d{1,2})(?:(?::|\.)?(\d{2}))?/i.exec(description);
  return match ? { hour: Number.parseInt(match[1], 10), minute: Number.parseInt(match[2] ?? "0", 10) } : { hour: FALLBACK_EVENT_HOUR, minute: FALLBACK_EVENT_MINUTE };
}

function extractPreview(description) {
  const lines = description.split("\n").filter(Boolean).filter((line) => !/^(termin|miejsce|pakowanie|zbiorka|soundcheck|godzina|dresscode)/i.test(stripDiacritics(line).toLowerCase()));
  const source = lines.join(" ") || description.replace(/\n/g, " ");
  return source.length > 220 ? `${source.slice(0, 217).trimEnd()}...` : source;
}

function looksLikeSetlist(text) {
  const normalized = stripDiacritics(text).toLowerCase();
  return normalized.includes("setlista") || normalized.includes("setlist") || normalized.includes("lista utwor") || /\bi set\b/.test(normalized) || normalized.includes(" bis:");
}

function parseSetlistItems(text, itemIdPrefix) {
  return text
    .replace(/\s+(\d+\.)/g, "\n$1")
    .split("\n")
    .map((line) => normalizeWhitespace(line).replace(/^\d+\.\s*/, "").replace(/^[•*-]\s*/, ""))
    .filter(Boolean)
    .map((line, index) => ({ id: `${itemIdPrefix}-${index + 1}`, label: line }));
}

function parseSetlistSections(text, eventId) {
  const marker = /(setlista|setlist|lista utwor(?:ow)?)/i.exec(text);
  const source = marker ? text.slice((marker.index ?? 0) + marker[0].length) : text;
  const normalized = source.replace(/^[:\s-]+/, "").replace(/\b(I{1,4})\s*set\b\s*:?\s*/gi, (_, numeral) => `\n${numeral.toUpperCase()} SET:\n`).replace(/\bset\s*(I{1,4})\b\s*:?\s*/gi, (_, numeral) => `\n${numeral.toUpperCase()} SET:\n`).replace(/\b(BIS)\b\s*:?\s*/gi, "\nBIS:\n").trim();
  const headingPattern = /(?:^|\n)\s*((?:[IVX]+ SET|BIS))\s*:\s*/g;
  const matches = Array.from(normalized.matchAll(headingPattern));
  if (matches.length === 0) {
    const items = parseSetlistItems(normalized, `${eventId}-setlist-program-item`);
    return items.length > 0 ? [{ id: `${eventId}-setlist-section-1`, title: "Program", items }] : [];
  }

  const sections = [];
  const leadingContent = normalized.slice(0, matches[0].index ?? 0).trim();
  if (leadingContent) {
    const sectionId = `${eventId}-setlist-section-${sections.length + 1}`;
    const items = parseSetlistItems(leadingContent, `${sectionId}-item`);
    if (items.length > 0) {
      sections.push({ id: sectionId, title: "Program", items });
    }
  }

  matches.forEach((match, index) => {
    const next = matches[index + 1];
    const content = normalized.slice((match.index ?? 0) + match[0].length, next?.index ?? normalized.length).trim();
    const sectionId = `${eventId}-setlist-section-${sections.length + 1}`;
    const items = parseSetlistItems(content, `${sectionId}-item`);
    if (items.length > 0) {
      sections.push({ id: sectionId, title: normalizeWhitespace(match[1]), items });
    }
  });

  return sections;
}

function buildSetlist(eventId, posts) {
  const setlistPost = posts.find((post) => looksLikeSetlist(post.bodyText)) ?? null;
  if (!setlistPost) {
    return {
      eventId,
      preview: "Setlist not posted yet.",
      modeHint: "fit",
      sections: [{ id: `${eventId}-setlist-section-1`, title: "Pending", items: [{ id: `${eventId}-setlist-section-1-item-1`, label: "Setlist not posted yet." }] }],
      postId: null,
    };
  }
  const sections = parseSetlistSections(setlistPost.bodyText, eventId);
  const labels = sections.flatMap((section) => section.items.map((item) => item.label));
  const totalChars = labels.reduce((sum, value) => sum + value.length, 0);
  return {
    eventId,
    preview: labels.length > 0 ? `${labels.slice(0, 4).join(" | ")}${labels.length > 4 ? " | ..." : ""}` : "Setlist not posted yet.",
    modeHint: labels.length <= 8 && totalChars <= 180 ? "fit" : "scroll",
    sections: sections.length > 0 ? sections : [{ id: `${eventId}-setlist-section-1`, title: "Pending", items: [{ id: `${eventId}-setlist-section-1-item-1`, label: "Setlist not posted yet." }] }],
    postId: setlistPost.postId,
  };
}

function createSquad(eventId, pollOptions, usersByKey) {
  const groups = new Map();
  for (const option of pollOptions) {
    const status = attendanceStatusFromLabel(option.label);
    if (status !== "going" && status !== "maybe") {
      continue;
    }
    for (const participant of option.participants) {
      const user = usersByKey.get(toUserKey(participant)) ?? usersByKey.get(`username:${participant.username.toLowerCase()}`);
      if (!user) {
        continue;
      }
      const instrument = user.primaryInstrument ?? UNKNOWN_INSTRUMENT_LABEL;
      const group = groups.get(instrument) ?? { instrument, confirmedMembers: [], maybeMembers: [] };
      const target = status === "going" ? group.confirmedMembers : group.maybeMembers;
      target.push({ id: user.id, fullName: user.fullName });
      groups.set(instrument, group);
    }
  }
  const values = Array.from(groups.values()).sort((left, right) => {
    if (left.instrument === UNKNOWN_INSTRUMENT_LABEL) {
      return 1;
    }
    if (right.instrument === UNKNOWN_INSTRUMENT_LABEL) {
      return -1;
    }
    return left.instrument.localeCompare(right.instrument);
  });
  return { eventId, groups: values.length > 0 ? values : [{ instrument: UNKNOWN_INSTRUMENT_LABEL, confirmedMembers: [], maybeMembers: [] }] };
}

function buildEvent(rawThread, currentUser, usersByKey) {
  const opener = rawThread.posts[0];
  const description = opener?.bodyText ?? "No event description was found in the forum thread.";
  const startsAt = rawThread.titleDate ? toWarsawIso({ ...rawThread.titleDate, ...extractStartClock(description) }) : opener?.createdAt ?? new Date().toISOString();
  const attendanceSummary = { going: 0, maybe: 0, notGoing: 0, noResponse: 0, userStatus: "no_response", userStatusLabel: "No response" };
  const attendanceGroups = [];
  for (const option of rawThread.poll?.options ?? []) {
    const status = attendanceStatusFromLabel(option.label);
    if (status === "going") attendanceSummary.going += option.count;
    if (status === "maybe") attendanceSummary.maybe += option.count;
    if (status === "not_going") attendanceSummary.notGoing += option.count;
    if (option.participants.some((participant) => participant.username.toLowerCase() === currentUser.username.toLowerCase())) {
      attendanceSummary.userStatus = status;
      attendanceSummary.userStatusLabel = attendanceLabel(status);
    }

    attendanceGroups.push({
      status,
      label: attendanceOptionLabel(status),
      count: option.count,
      participants: option.participants
        .map((participant) => {
          const user =
            usersByKey.get(toUserKey(participant)) ??
            usersByKey.get(`username:${participant.username.toLowerCase()}`);

          return {
            id: user?.id ?? `forum-username-${slugify(participant.username)}`,
            fullName: user?.fullName ?? participant.username,
            ...(user?.primaryInstrument ? { primaryInstrument: user.primaryInstrument } : {}),
          };
        })
        .sort((left, right) => left.fullName.localeCompare(right.fullName, "pl")),
    });
  }
  const setlist = buildSetlist(rawThread.eventId, rawThread.posts);
  const updates = [];
  const comments = [];
  for (const post of rawThread.posts.slice(1)) {
    if (setlist.postId && post.postId === setlist.postId) {
      continue;
    }
    const author = usersByKey.get(toUserKey(post.author)) ?? usersByKey.get(`username:${post.author.username.toLowerCase()}`);
    const entry = { id: `${rawThread.eventId}-post-${post.postId}`, authorName: author?.fullName ?? post.author.username, createdAt: post.createdAt, body: post.bodyText };
    if (opener && opener.author.username.toLowerCase() === post.author.username.toLowerCase()) {
      updates.push(entry);
    } else {
      comments.push(entry);
    }
  }
  const listItem = {
    id: rawThread.eventId,
    title: rawThread.title,
    startsAt,
    venue: extractVenue(description),
    preview: extractPreview(description),
    attendanceStatus: attendanceSummary.userStatus,
    attendanceLabel: attendanceSummary.userStatusLabel,
    updateCount: updates.length,
    commentCount: comments.length,
  };
  return {
    listItem,
    detail: {
      ...listItem,
      description,
      updates,
      comments,
      attendanceSummary,
      attendanceGroups,
      setlist: { eventId: setlist.eventId, preview: setlist.preview, modeHint: setlist.modeHint, sections: setlist.sections },
      squad: createSquad(rawThread.eventId, rawThread.poll?.options ?? [], usersByKey),
    },
  };
}

function uniqueParticipants(rawThreads) {
  const result = [];
  const seen = new Set();
  for (const rawThread of rawThreads) {
    for (const post of rawThread.posts) {
      const key = toUserKey(post.author);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(post.author);
      }
    }
    for (const option of rawThread.poll?.options ?? []) {
      for (const participant of option.participants) {
        const key = toUserKey(participant);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(participant);
        }
      }
    }
  }
  return result;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function createSnapshotFile(snapshot) {
  return `import type { EventDetail, EventListItem, UserProfile } from "../../domain/models";

export const forumSnapshot: {
  metadata: {
    generatedAt: string;
    source: string;
  };
  currentUser: UserProfile;
  events: EventListItem[];
  eventDetailsById: Record<string, EventDetail>;
} = ${JSON.stringify(snapshot, null, 2)};
`;
}

async function main() {
  await loadEnv();
  const config = await readConfig();
  const overrides = await readOverrides();
  const username = process.env.ORAGH_FORUM_USERNAME;
  const password = process.env.ORAGH_FORUM_PASSWORD;
  if (!username || !password) {
    throw new Error("Missing ORAGH_FORUM_USERNAME or ORAGH_FORUM_PASSWORD environment variables.");
  }
  const jar = await loginToForum(config.baseUrl, username, password);
  const memberListPage = await requestHtml({ jar, url: resolveUrl(config.baseUrl, config.memberListPath) });
  const memberListPath = await saveCacheFile("memberlist.html", memberListPage.html);
  const forumDiscovery = Array.isArray(config.eventThreadUrls) && config.eventThreadUrls.length > 0
    ? {
        threads: config.eventThreadUrls.map((threadUrl) => ({
          threadId: new URL(resolveUrl(config.baseUrl, threadUrl)).searchParams.get("tid") ?? sanitizeFileName(threadUrl),
          url: resolveUrl(config.baseUrl, threadUrl),
          sourceForumUrl: null,
          sourcePage: null,
        })),
        forumPages: [],
      }
    : await discoverConcertThreadsFromForums({
        jar,
        baseUrl: config.baseUrl,
        forumPaths: config.concertForumPaths,
        eventYear: config.eventYear,
        maxThreads: config.maxThreads,
      });

  const rawThreads = [];
  const manifestThreads = [];
  for (const threadConfig of forumDiscovery.threads) {
    const resolvedThreadUrl = resolveUrl(config.baseUrl, threadConfig.url);
    const firstThreadPage = await requestHtml({ jar, url: resolvedThreadUrl });
    const parsedFirstPage = parseThreadPage(firstThreadPage.html, resolvedThreadUrl, config.baseUrl);
    const pageNumbers = extractThreadPageNumbers(firstThreadPage.html, config.baseUrl, resolvedThreadUrl);
    const threadCachePaths = [
      await saveCacheFile(`threads/${parsedFirstPage.threadId}-${sanitizeFileName(parsedFirstPage.title)}-page-1.html`, firstThreadPage.html),
    ];
    const parsedPages = [parsedFirstPage];

    for (const pageNumber of pageNumbers) {
      if (pageNumber === 1) {
        continue;
      }
      const pageUrl = new URL(resolvedThreadUrl);
      pageUrl.searchParams.set("page", String(pageNumber));
      const threadPage = await requestHtml({ jar, url: pageUrl.toString() });
      parsedPages.push(parseThreadPage(threadPage.html, pageUrl.toString(), config.baseUrl));
      threadCachePaths.push(
        await saveCacheFile(
          `threads/${parsedFirstPage.threadId}-${sanitizeFileName(parsedFirstPage.title)}-page-${pageNumber}.html`,
          threadPage.html,
        ),
      );
    }

    const mergedPosts = mergeAndSortThreadPosts(parsedPages);
    const pollResultsUrl = parsedPages.find((page) => page.pollResultsUrl)?.pollResultsUrl ?? null;
    const parsedThread = {
      ...parsedFirstPage,
      posts: mergedPosts,
      pollResultsUrl,
    };
    let poll = null;
    let pollCachePath = null;
    if (parsedThread.pollResultsUrl) {
      const pollPage = await requestHtml({ jar, url: parsedThread.pollResultsUrl });
      poll = parsePollResultsPage(pollPage.html, config.baseUrl);
      const pollId = new URL(parsedThread.pollResultsUrl).searchParams.get("pid") ?? parsedThread.threadId;
      pollCachePath = await saveCacheFile(`polls/poll-${pollId}.html`, pollPage.html);
    }
    rawThreads.push({ ...parsedThread, eventId: `forum-event-${parsedThread.threadId}`, poll });
    manifestThreads.push({
      url: resolveUrl(config.baseUrl, threadConfig.url),
      title: parsedThread.title,
      sourceForumUrl: threadConfig.sourceForumUrl,
      sourcePage: threadConfig.sourcePage,
      cachePath: threadCachePaths[0] ?? null,
      cachePaths: threadCachePaths,
      discoveredPages: pageNumbers,
      pollCachePath,
      postCount: parsedThread.posts.length,
      hasSetlistPost: Boolean(parsedThread.posts.find((post) => looksLikeSetlist(post.bodyText))),
    });
  }
  const usersByKey = new Map();
  await mapWithConcurrency(uniqueParticipants(rawThreads), 5, async (participant) => {
    const cacheKey = toUserKey(participant);
    if (usersByKey.has(cacheKey)) {
      return;
    }
    let parsed = { uid: participant.uid ?? null, username: participant.username, fullName: participant.username };
    if (participant.uid) {
      const profilePage = await requestHtml({ jar, url: resolveUrl(config.baseUrl, `/member.php?action=profile&uid=${participant.uid}`) });
      await saveCacheFile(`profiles/uid-${participant.uid}.html`, profilePage.html);
      parsed = parseProfilePage(profilePage.html, participant);
    }
    const user = applyOverrides({ id: participant.uid ? `forum-user-${participant.uid}` : `forum-user-${slugify(parsed.username)}`, uid: parsed.uid, username: parsed.username, fullName: parsed.fullName }, overrides);
    usersByKey.set(cacheKey, user);
    usersByKey.set(`username:${user.username.toLowerCase()}`, user);
  });
  let currentUser = usersByKey.get(`username:${username.toLowerCase()}`) ?? null;
  if (!currentUser) {
    const currentUserPage = await requestHtml({ jar, url: resolveUrl(config.baseUrl, "/member.php?action=profile") });
    await saveCacheFile("profiles/current-user.html", currentUserPage.html);
    const parsed = parseProfilePage(currentUserPage.html, { uid: null, username });
    currentUser = applyOverrides({ id: `forum-user-${slugify(parsed.username)}`, uid: null, username: parsed.username, fullName: parsed.fullName }, overrides);
  }
  const mappedEvents = rawThreads
    .map((rawThread) => buildEvent(rawThread, currentUser, usersByKey))
    .sort((left, right) => left.detail.startsAt.localeCompare(right.detail.startsAt));
  const snapshot = {
    metadata: { generatedAt: new Date().toISOString(), source: "forum-sync:concert-forums" },
    currentUser: { id: currentUser.id, fullName: currentUser.fullName, role: "member", ...(currentUser.primaryInstrument ? { primaryInstrument: currentUser.primaryInstrument } : {}) },
    events: mappedEvents.map((event) => event.listItem),
    eventDetailsById: Object.fromEntries(mappedEvents.map((event) => [event.detail.id, event.detail])),
  };
  const shouldWriteLocalSnapshot = process.env.FORUM_SYNC_WRITE_LOCAL_SNAPSHOT === "1";
  if (shouldWriteLocalSnapshot) {
    await fs.writeFile(SNAPSHOT_PATH, createSnapshotFile(snapshot), "utf8");
  }
  await saveCacheFile("snapshot.json", JSON.stringify(snapshot, null, 2));
  const manifestPath = path.join(CACHE_DIR, "manifest.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: config.baseUrl,
        memberListPath,
        concertForumPaths: forumDiscovery.forumPages,
        eventYear: config.eventYear,
        snapshotPath: shouldWriteLocalSnapshot ? SNAPSHOT_PATH : null,
        threadCount: manifestThreads.length,
        threads: manifestThreads,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`Forum sync completed. Manifest: ${manifestPath}`);
  if (shouldWriteLocalSnapshot) {
    console.log(`Snapshot written to ${SNAPSHOT_PATH}`);
  } else {
    console.log("Snapshot written to .cache/forum-sync/snapshot.json (local TS snapshot update skipped).");
    console.log("Set FORUM_SYNC_WRITE_LOCAL_SNAPSHOT=1 to update src/data/generated/forumSnapshot.ts.");
  }
  console.log(`Imported ${mappedEvents.length} concert thread(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
