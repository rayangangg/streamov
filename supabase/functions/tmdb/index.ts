// TMDB proxy. Hides the commercial read-access token on the server side
// and adds permissive CORS so the SPA can call it directly.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TMDB_BASE = "https://api.themoviedb.org/3";
const TOKEN = Deno.env.get("TMDB_READ_ACCESS_TOKEN") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!TOKEN) {
    return new Response(
      JSON.stringify({ error: "TMDB_READ_ACCESS_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const url = new URL(req.url);
    // Path forwarded after the function name, e.g. /tmdb/movie/123
    // We also accept ?path=/movie/123 as a fallback.
    const fnPrefix = url.pathname.replace(/^\/+/, "").split("/")[0]; // "tmdb"
    let tmdbPath =
      url.pathname.slice(fnPrefix.length + 1) || url.searchParams.get("path") || "";
    if (!tmdbPath.startsWith("/")) tmdbPath = "/" + tmdbPath;

    // Drop our own ?path param before forwarding
    const params = new URLSearchParams(url.search);
    params.delete("path");
    const qs = params.toString();
    const target = `${TMDB_BASE}${tmdbPath}${qs ? "?" + qs : ""}`;

    const upstream = await fetch(target, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
      },
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/json",
        // Let the browser cache identical TMDB responses for 5 min
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e?.message ?? e) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
