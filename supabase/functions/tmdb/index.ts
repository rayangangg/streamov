// TMDB proxy with hidden commercial read-access token.
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
    // Strip the leading "/<function-name>" prefix, whatever it is.
    // Supabase routes /functions/v1/tmdb/<rest> → req.url ends with /tmdb/<rest>.
    let tmdbPath = url.pathname.replace(/^.*?\/tmdb/, "");
    if (!tmdbPath) tmdbPath = url.searchParams.get("path") || "";
    if (!tmdbPath.startsWith("/")) tmdbPath = "/" + tmdbPath;
    if (tmdbPath === "/") tmdbPath = "/configuration";

    const params = new URLSearchParams(url.search);
    params.delete("path");
    const qs = params.toString();
    const target = `${TMDB_BASE}${tmdbPath}${qs ? "?" + qs : ""}`;

    const upstream = await fetch(target, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const body = await upstream.text();
    return new Response(body, {
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
