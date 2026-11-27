/**
 * Builds the URL of a Supabase Edge Function.
 *
 * Functions live under `<SUPABASE_URL>/functions/v1/<name>`. That path works for
 * self-hosted Supabase (orbit) and for Supabase Cloud alike, so the URL is never
 * derived from a `*.supabase.co` project ref.
 *
 * Pass env values in from the call site: Expo only inlines `process.env.EXPO_PUBLIC_*`
 * when each variable is read by its full static name.
 */
export function resolveEdgeFunctionUrl(
  functionName: string,
  explicitUrl: string | undefined,
  supabaseUrl: string | undefined,
): string | null {
  const explicit = explicitUrl?.trim();
  if (explicit) {
    return explicit;
  }

  const base = supabaseUrl?.trim();
  if (!base) {
    return null;
  }

  try {
    const parsed = new URL(base);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${path}/functions/v1/${functionName}`;
  } catch {
    return null;
  }
}
