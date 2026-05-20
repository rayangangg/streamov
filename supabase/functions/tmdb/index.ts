Deno.serve((req) => {
  return new Response(JSON.stringify({ ok: true, url: req.url }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
