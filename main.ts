// main.ts - Entry point for Deno Deploy

// CORS headers for cross-origin requests
const corsHeaders = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS")?.split(",") || [];
  if (allowedOrigins.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-key, Authorization",
      "Access-Control-Allow-Credentials": "true",
    };
  }
  return {};
};

// Main server handler
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Handle CORS preflight (OPTIONS) requests
  if (req.method === "OPTIONS") {
    const headers = corsHeaders(req);
    return new Response(null, { status: 204, headers });
  }

  // Route: /api/health
  if (path === "/api/health" && req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }

  // Route: /api/mcqs (Fetch MCQs by chapter)
  if (path === "/api/mcqs" && req.method === "POST") {
    try {
      const { chapter } = await req.json();
      if (!chapter) {
        return new Response(JSON.stringify({ error: "Chapter is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(req) },
        });
      }

      const { getMCQs } = await import("./mcq-generator.ts");
      const data = await getMCQs(chapter);

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      });
    }
  }

  // Route: /api/admin/generate (Admin - Manual or Scheduled)
  if (path === "/api/admin/generate" && req.method === "POST") {
    const adminKey = req.headers.get("x-admin-key");
    const expectedKey = Deno.env.get("ADMIN_API_KEY");
    
    if (!expectedKey || adminKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      });
    }

    try {
      const { generateMCQs } = await import("./mcq-generator.ts");
      const result = await generateMCQs();
      return new Response(JSON.stringify({ message: "Generation started", result }), {
        status: 202,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      });
    }
  }

  // Route: /api/bundles (Get bundle for a chapter)
  if (path === "/api/bundles" && req.method === "POST") {
    try {
      const { chapter } = await req.json();
      if (!chapter) {
        return new Response(JSON.stringify({ error: "Chapter is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(req) },
        });
      }

      const { getBundle } = await import("./mcq-generator.ts");
      const bundle = await getBundle(chapter);

      return new Response(JSON.stringify({ bundle }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      });
    }
  }

  // 404 for any other route
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
});
