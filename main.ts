// main.ts - SIMPLE & WORKING
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@libsql/client@0.7.0";
import { generateMCQs, getMCQs } from "./mcq-generator.ts";
import { getDb } from "./utils.ts";

const TURSO_URL = Deno.env.get("TURSO_DATABASE_URL")!;
const TURSO_TOKEN = Deno.env.get("TURSO_AUTH_TOKEN")!;
const ADMIN_KEY = Deno.env.get("ADMIN_API_KEY")!;
const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") || "*";

const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

// CORS Headers
function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS === "*" ? "*" : origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
  };
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const origin = req.headers.get("origin") || "";
  
  // OPTIONS (CORS Preflight)
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  // Health Check
  if (url.pathname === "/api/health" && req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  // Get MCQs (Frontend)
  if (url.pathname === "/api/mcqs" && req.method === "POST") {
    try {
      const { chapter } = await req.json();
      if (!chapter) throw new Error("Chapter required");
      const data = await getMCQs(chapter);
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
  }

  // Admin Generate
  if (url.pathname === "/api/admin/generate" && req.method === "POST") {
    const key = req.headers.get("x-admin-key");
    if (key !== ADMIN_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
    try {
      const result = await generateMCQs();
      return new Response(JSON.stringify({ success: true, result }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
  }

  // 404
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
});
