// Web-aligned API layer for TMDB + Anilist integrations.
// No Electron / Node APIs — pure browser fetch.

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG_BASE = "https://image.tmdb.org/t/p";
const ANILIST_ENDPOINT = "https://graphql.anilist.co";

export const ANIME_DEFAULT_SOURCE = "allmanga";
export const NON_ANIME_DEFAULT_SOURCE = "vidsrc";

// Player source matrix — placeholder embed URLs for compliance testing.
export const PLAYER_SOURCES = [
  {
    id: "vidsrc",
    label: "Source A",
    movieUrl: (id) => `https://example.com/embed/alpha/${id}`,
    tvUrl: (id, season, ep) =>
      `https://example.com/embed/alpha/${id}?s=${season}&e=${ep}`,
    supportsProgress: true,
    async: false,
  },
  {
    id: "videasy",
    label: "Source B",
    movieUrl: (id) => `https://example.com/embed/beta/${id}`,
    tvUrl: (id, season, ep) =>
      `https://example.com/embed/beta/${id}?s=${season}&e=${ep}`,
    supportsProgress: true,
    async: false,
  },
  {
    id: "2embed",
    label: "Source C",
    movieUrl: (id) => `https://example.com/embed/gamma/${id}`,
    tvUrl: (id, season, ep) =>
      `https://example.com/embed/gamma/${id}?s=${season}&e=${ep}`,
    supportsProgress: false,
    async: false,
  },
  {
    id: "allmanga",
    label: "Source D",
    movieUrl: (id) => `https://example.com/embed/delta/${id}`,
    tvUrl: (id, season, ep) =>
      `https://example.com/embed/delta/${id}?s=${season}&e=${ep}`,
    supportsProgress: false,
    async: true,
  },
];

const sourceById = (sourceId) =>
  PLAYER_SOURCES.find((s) => s.id === sourceId) || PLAYER_SOURCES[0];

// ---------- TMDB ----------

export function getApiKey() {
  const envKey =
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_TMDB_API_KEY;
  if (envKey) return envKey;
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage.getItem("tmdb_api_key") || "";
  }
  return "";
}

export function imgUrl(path, size = "w500") {
  if (!path) return "";
  return `${TMDB_IMG_BASE}/${size}${path}`;
}

export async function tmdbFetch(path, apiKey) {
  const key = apiKey || getApiKey();
  const url = new URL(`${TMDB_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (key && !url.searchParams.has("api_key")) {
    url.searchParams.set("api_key", key);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`TMDB request failed (${res.status}): ${path}`);
  }
  return res.json();
}

export async function fetchEpisodeGroup(groupId) {
  if (!groupId) return null;
  return tmdbFetch(`/tv/episode_group/${groupId}`);
}

// ---------- Player sources ----------

export function getSourceUrl(sourceId, type, id, season, ep) {
  const src = sourceById(sourceId);
  if (type === "movie") return src.movieUrl(id);
  return src.tvUrl(id, season ?? 1, ep ?? 1);
}

export function sourceSupportsProgress(sourceId) {
  return !!sourceById(sourceId).supportsProgress;
}

export function sourceIsAsync(sourceId) {
  return !!sourceById(sourceId).async;
}

// ---------- Anime / Anilist ----------

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
  if (genres.includes("animation")) {
    const countries = d.origin_country || d.production_countries?.map((c) => c.iso_3166_1) || [];
    if (countries.includes("JP")) return true;
    const langs = [d.original_language, ...(d.spoken_languages?.map((l) => l.iso_639_1) || [])];
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
}

export async function buildAnilistSeasons(detail) {
  if (!detail) return [];
  const seasons = Array.isArray(detail.seasons) ? detail.seasons : [];
  const filtered = seasons.filter((s) => s.season_number && s.season_number > 0);
  return filtered.map((s) => ({
    id: `${detail.id}-s${s.season_number}`,
    seasonNumber: s.season_number,
    name: s.name || `Season ${s.season_number}`,
    episodeCount: s.episode_count || 0,
    airDate: s.air_date || null,
    poster: imgUrl(s.poster_path, "w342"),
    overview: s.overview || "",
  }));
}
