// TMDB proxy. Hides the commercial read-access token on the server side
// and adds permissive CORS so the SPA can call it directly.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TMDB_BASE = "https://api.themoviedb.org/3";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const token = Deno.env.get("TMDB_READ_ACCESS_TOKEN") || "";
  if (!token) {
    return new Response(
      JSON.stringify({ error: "TMDB_READ_ACCESS_TOKEN not configured" }),
      {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const url = new URL(req.url);
    // Strip /<function-name> prefix; what remains is the TMDB path.
    let tmdbPath = url.pathname.replace(/^.*?\/tmdb/, "");
    if (!tmdbPath) tmdbPath = url.searchParams.get("path") || "/configuration";
    if (!tmdbPath.startsWith("/")) tmdbPath = "/" + tmdbPath;

    const params = new URLSearchParams(url.search);
    params.delete("path");
    const qs = params.toString();
    const target = `${TMDB_BASE}${tmdbPath}${qs ? "?" + qs : ""}`;

    const upstream = await fetch(target, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        // Force uncompressed body so Deno doesn't need a decoder.
        "Accept-Encoding": "identity",
      },
    });

    // Read as ArrayBuffer (works for any payload, no encoding guessing)
    const buf = await upstream.arrayBuffer();
    return new Response(buf, {
      status: upstream.status,
      headers: {
        ...CORS,
        "Content-Type":
          upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String((e && e.message) || e) }),
      {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      },
    );
  }
});
