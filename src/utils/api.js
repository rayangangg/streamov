// ── Streaming Player Sources (Safe Ported Version for Lovable) ───────────────
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
    tvUrl: (id, season, ep) => `https://example.com/embed/tv/${id}/${season}/${ep}`,
  },
  {
    id: "2embed",
    label: "Source 3",
    tag: null,
    supportsProgress: false,
    movieUrl: (id) => `https://example.com/player/${id}`,
    tvUrl: (id, season, ep) => `https://example.com/player/${id}/${season}/${ep}`,
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