export const MAX_DISPLAY_NAME = 40;

// A room's video URL is broadcast to every participant and used directly as a
// <video src> or YouTube embed, so it has to be a plain web URL — javascript:,
// data: and file: URLs have no business reaching another person's page.
// Returns the normalized URL, or null if it isn't usable.
export function normalizeVideoUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.href;
}

// Names are embedded in the guest token and shown in every presence list and
// chat line, so they get trimmed and capped rather than trusted at any length.
export function normalizeDisplayName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_DISPLAY_NAME);
  return trimmed || null;
}
