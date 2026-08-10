// main.ts - FINAL CORRECT VERSION
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@libsql/client@0.7.0";
import { generateAndStoreMCQs } from "./mcq-generator.ts";
import { createSessionToken, verifySessionToken, hashIP } from "./utils.ts";

const TURSO_URL = Deno.env.get("TURSO_DATABASE_URL")!;
const TURSO_TOKEN = Deno.env.get("TURSO_AUTH_TOKEN")!;
const ADMIN_KEY = Deno.env.get("ADMIN_API_KEY")!;
const JWT_SECRET = Deno.env.get("JWT_SECRET")!;
const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") || "*";

const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("origin") || "";
  
  const headers = new Headers({
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS === "*" ? "*" : origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key, authorization",
  });

  if (req.method === "OPTIONS") return new Response(null, { headers });

  // Health Check
  if (url.pathname === "/api/health") {
    return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), { headers });
  }

  // Get MCQs (Frontend वाला)
  if (url.pathname === "/api/mcqs" && req.method === "POST") {
    try {
      const { chapter } = await req.json();
      if (!chapter) throw new Error("Chapter required");
      const { getMCQs } = await import("./mcq-generator.ts");
      const data = await getMCQs(chapter);
      return new Response(JSON.stringify(data), { status: 200, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // Admin Generate (Manual)
  if (url.pathname === "/api/admin/generate" && req.method === "POST") {
    const key = req.headers.get("x-admin-key");
    if (key !== ADMIN_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
    try {
      const { generateMCQs } = await import("./mcq-generator.ts");
      const result = await generateMCQs();
      return new Response(JSON.stringify({ success: true, result }), { status: 200, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers });
}

serve(handleRequest);
