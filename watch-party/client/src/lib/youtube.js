// Extracts a YouTube video ID from the common URL shapes people paste in:
// watch?v=, youtu.be/, embed/, shorts/. Returns null for anything else, so
// callers can treat non-matches as a direct video file URL.
export function extractYouTubeId(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    return parsed.pathname.slice(1).split("/")[0] || null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
    const embedMatch = parsed.pathname.match(/^\/(embed|shorts)\/([^/]+)/);
    if (embedMatch) return embedMatch[2];
  }
  return null;
}

let apiPromise = null;

// Loads the YouTube IFrame Player API script once and resolves with the
// `YT` global once `YT.Player` is actually usable. Safe to call repeatedly —
// later calls reuse the same in-flight/resolved promise.
export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });

  return apiPromise;
}
