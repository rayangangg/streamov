// ── Streambert API utilities (web edition) ─────────────────────────────────
// Pure browser fetch. TMDB token comes from import.meta.env.VITE_TMDB_API_KEY
// or, as a fallback, from localStorage ("streambert_apikey").
//
// PLAYER_SOURCES are kept as inert example.com placeholders. The embed slot
// will render those URLs but they don't resolve to any actual content — the
// player UI is structural only in the web edition.

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG_BASE = "https://image.tmdb.org/t/p";
const ANILIST_ENDPOINT = "https://graphql.anilist.co";

// ── Player sources (inert placeholders) ──────────────────────────────────
export const PLAYER_SOURCES = [
  {
    id: "vidsrc",
    label: "Source 1",
    tag: null,
    supportsProgress: false,
    movieUrl: (id) => `https://example.com/movie/${id}`,
    tvUrl: (id, season, ep) => `https://example.com/tv/${id}/${season}/${ep}`,
  },
  {
    id: "videasy",
    label: "Source 2",
    tag: null,
    supportsProgress: false,
    movieUrl: (id) => `https://example.com/embed/movie/${id}`,
    tvUrl: (id, season, ep) =>
      `https://example.com/embed/tv/${id}/${season}/${ep}`,
  },
  {
    id: "2embed",
    label: "Source 3",
    tag: null,
    supportsProgress: false,
    movieUrl: (id) => `https://example.com/player/${id}`,
    tvUrl: (id, season, ep) =>
      `https://example.com/player/${id}/${season}/${ep}`,
  },
  {
    id: "allmanga",
    label: "Source 4",
    tag: "ANIME",
    supportsProgress: true,
    async: true,
    movieUrl: () => "https://example.com/anime",
    tvUrl: () => "https://example.com/anime",
  },
];

export const ANIME_DEFAULT_SOURCE = "allmanga";
export const NON_ANIME_DEFAULT_SOURCE = "vidsrc";

// Sources whose embeds historically need request interception (not available
// in a plain browser context — kept empty so the UI can branch safely).
export const NEEDS_INTERCEPT = new Set();

const sourceById = (id) =>
  PLAYER_SOURCES.find((s) => s.id === id) || PLAYER_SOURCES[0];

export function sourceSupportsProgress(id) {
  return !!sourceById(id).supportsProgress;
}

export function sourceIsAsync(id) {
  return !!sourceById(id).async;
}

export function getSourceUrl(sourceId, type, id, season, ep) {
  const src = sourceById(sourceId);
  return type === "movie" ? src.movieUrl(id) : src.tvUrl(id, season ?? 1, ep ?? 1);
}

// ── TMDB ────────────────────────────────────────────────────────────────
function envToken() {
  try {
    return (
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_TMDB_API_KEY) ||
      ""
    );
  } catch {
    return "";
  }
}

function getStoredToken() {
  try {
    const raw = localStorage.getItem("streambert_apikey");
    if (!raw) return "";
    // legacy: JSON-encoded by storage helper
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } catch {
    return "";
  }
}

function resolveToken(explicit) {
  return explicit || envToken() || getStoredToken() || "";
}

// Pluggable error handlers (used by App.jsx for offline / invalid token UX).
let onAuthError = null;
let onNetworkError = null;
export function setApiErrorHandlers({ onAuth, onNetwork } = {}) {
  onAuthError = typeof onAuth === "function" ? onAuth : null;
  onNetworkError = typeof onNetwork === "function" ? onNetwork : null;
}

export function imgUrl(path, size = "w500") {
  if (!path) return "";
  return `${TMDB_IMG_BASE}/${size}${path}`;
}

export async function tmdbFetch(path, apiKey) {
  const token = resolveToken(apiKey);
  const url = `${TMDB_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  let res;
  try {
    res = await fetch(url, {
      headers: token
        ? { Authorization: `Bearer ${token}`, Accept: "application/json" }
        : { Accept: "application/json" },
    });
  } catch (err) {
    onNetworkError?.(err);
    throw err;
  }
  if (res.status === 401 || res.status === 403) {
    onAuthError?.(res.status);
    throw new Error(`TMDB auth error (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`TMDB request failed (${res.status}): ${path}`);
  }
  return res.json();
}

export async function fetchEpisodeGroup(groupId) {
  if (!groupId) return null;
  try {
    return await tmdbFetch(`/tv/episode_group/${groupId}`);
  } catch {
    return null;
  }
}

// ── Anime / Anilist ──────────────────────────────────────────────────────
export function cleanAnilistDescription(desc) {
  if (!desc) return "";
  return desc
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isAnimeContent(item, details) {
  const d = details || item || {};
  const genres = (d.genres || []).map((g) =>
    typeof g === "string" ? g.toLowerCase() : (g.name || "").toLowerCase(),
  );
  const isAnimation = genres.includes("animation");
  if (isAnimation) {
    const countries =
      d.origin_country ||
      d.production_countries?.map((c) => c.iso_3166_1) ||
      [];
    if (countries.includes("JP")) return true;
    const langs = [
      d.original_language,
      ...(d.spoken_languages?.map((l) => l.iso_639_1) || []),
    ];
    if (langs.includes("ja")) return true;
  }
  const keywords = d.keywords?.results || d.keywords?.keywords || [];
  if (keywords.some((k) => /anime/i.test(k.name || ""))) return true;
  return false;
}

export async function fetchAnilistData(title) {
  if (!title) return null;
  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
        idMal
        title { romaji english native }
        description(asHtml: false)
        episodes
        format
        status
        startDate { year month day }
        coverImage { large extraLarge }
        bannerImage
        genres
        averageScore
        siteUrl
      }
    }
  `;
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables: { search: title } }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.Media || null;
  } catch {
    return null;
  }
}

export async function buildAnilistSeasons(detail) {
  if (!detail) return [];
  const seasons = Array.isArray(detail.seasons) ? detail.seasons : [];
  return seasons
    .filter((s) => s.season_number && s.season_number > 0)
    .map((s) => ({
      id: `${detail.id}-s${s.season_number}`,
      seasonNumber: s.season_number,
      name: s.name || `Season ${s.season_number}`,
      episodeCount: s.episode_count || 0,
      airDate: s.air_date || null,
      poster: imgUrl(s.poster_path, "w342"),
      overview: s.overview || "",
    }));
}
