const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  console.log("hit", req.method, req.url);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const token = Deno.env.get("TMDB_READ_ACCESS_TOKEN") || "";
    console.log("token len:", token.length);
    const url = new URL(req.url);
    let p = url.pathname.replace(/^.*?\/tmdb/, "");
    if (!p) p = "/configuration";
    if (!p.startsWith("/")) p = "/" + p;
    const params = new URLSearchParams(url.search);
    params.delete("path");
    const qs = params.toString();
    const target = `https://api.themoviedb.org/3${p}${qs ? "?" + qs : ""}`;
    console.log("→", target);
    const r = await fetch(target, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    console.log("←", r.status);
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    console.error("ERR", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
