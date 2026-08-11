// main.ts
import { createClient } from "https://esm.town/@turso/client";
import { generateAndStoreMCQs } from "./mcq-generator.ts";
import {
  createSessionToken, verifySessionToken, hashIP, timingSafeEqual, hmac
} from "./utils.ts";

// ---------- Environment ----------
const TURSO_URL = Deno.env.get("TURSO_DATABASE_URL")!;
const TURSO_TOKEN = Deno.env.get("TURSO_AUTH_TOKEN")!;
const ADMIN_KEY = Deno.env.get("ADMIN_API_KEY")!;
const JWT_SECRET = Deno.env.get("JWT_SECRET")!;
const QSTASH_SIGNING_SECRET = Deno.env.get("QSTASH_SIGNING_SECRET") || "";
const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") || "*";
const MAX_BODY_SIZE = 1_048_576;

const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
const kv = await Deno.openKv();

// ---------- Helpers ----------
async function logAudit(event: string, ip: string, details = "") {
  const id = crypto.randomUUID();
  const ipHashed = await hashIP(ip);
  await db.execute({
    sql: "INSERT INTO audit_log (id, event, ip_hash, details, timestamp) VALUES (?, ?, ?, ?, ?)",
    args: [id, event, ipHashed, details, Date.now()],
  }).catch(e => console.error("Audit fail:", e));
}

async function checkRateLimit(ip: string, limit: number, windowSec: number): Promise<boolean> {
  const key = ["rate", ip];
  const res = await kv.get<number>(key);
  const count = res.value ?? 0;
  if (count >= limit) return false;
  const r = await kv.atomic().check(res).set(key, count + 1, { expireIn: windowSec * 1000 }).commit();
  if (!r.ok) console.warn("Rate limit atomic fail", ip);
  return true;
}

async function tryLockTask(taskId: number): Promise<boolean> {
  const key = ["task_lock", taskId];
  const res = await kv.get<number>(key);
  if (res.value) return false;
  const r = await kv.atomic().check(res).set(key, 1, { expireIn: 120_000 }).commit();
  return r.ok;
}
async function unlockTask(taskId: number) { await kv.delete(["task_lock", taskId]); }

// ---------- QStash Signature Verification ----------
async function verifyQStashSignature(req: Request): Promise<boolean> {
  if (!QSTASH_SIGNING_SECRET) return false;
  const signature = req.headers.get("upstash-signature");
  if (!signature) return false;
  const bodyText = await req.clone().text();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(QSTASH_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  return await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(bodyText));
}

// ---------- CORS helper ----------
function isOriginAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS === "*") return true;
  const allowed = ALLOWED_ORIGINS.split(",").map(o => o.trim());
  return allowed.includes(origin);
}

// ---------- DB query with timeout ----------
async function dbQueryWithTimeout(sql: string, args: any[], timeoutMs = 5000) {
  const queryPromise = db.execute({ sql, args });
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Database timeout")), timeoutMs)
  );
  return Promise.race([queryPromise, timeoutPromise]) as ReturnType<typeof db.execute>;
}

// ---------- Request Handler ----------
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const correlationId = req.headers.get("x-correlation-id") || crypto.randomUUID();
  const origin = req.headers.get("origin") || "";

  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", isOriginAllowed(origin) ? origin : "");
  headers.set("Access-Control-Allow-Headers",
    "x-admin-key, content-type, x-correlation-id, authorization, x-user-id, upstash-signature");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Correlation-ID", correlationId);

  if (req.method === "OPTIONS") return new Response(null, { headers });

  // ---------- PUBLIC: Health ----------
  if (url.pathname === "/api/health") {
    return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), { headers });
  }

  // ---------- PUBLIC: Get Session Token ----------
  if (url.pathname === "/api/session-token" && req.method === "POST") {
    if (!(await checkRateLimit(ip, 5, 60))) {
      return new Response(JSON.stringify({ error: "Too many token requests" }), { status: 429, headers });
    }
    let body: any = {};
    try { body = await req.json().catch(() => ({})); } catch { /* ignore */ }
    const userId = body.userId || "anon_" + crypto.randomUUID().slice(0, 8);
    const token = await createSessionToken(userId, JWT_SECRET);
    const sessionId = atob(token).split(':')[2];
    await kv.set(["session", sessionId], { userId, submitted: false }, { expireIn: 30 * 60 * 1000 });
    return new Response(JSON.stringify({ token, userId }), { headers });
  }

  // ---------- PUBLIC: Protected Bundle (from Turso) ----------
  if (url.pathname.startsWith("/api/bundle/") && req.method === "GET") {
    if (!(await checkRateLimit(ip, 10, 60))) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers });
    }
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), { status: 401, headers });
    }
    const tokenData = await verifySessionToken(token, JWT_SECRET);
    if (!tokenData) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 403, headers });
    }

    const chapter = decodeURIComponent(url.pathname.replace("/api/bundle/", "")).toLowerCase();
    try {
      const result = await dbQueryWithTimeout(
        "SELECT data FROM bundles WHERE chapter = ? ORDER BY version DESC LIMIT 1",
        [chapter]
      );
      if (result.rows.length === 0) {
        return new Response(JSON.stringify({ error: "Bundle not found" }), { status: 404, headers });
      }
      const data = result.rows[0].data as ArrayBuffer;
      const respHeaders = new Headers(headers);
      respHeaders.set("Content-Type", "application/json");
      respHeaders.set("Content-Encoding", "gzip");
      respHeaders.set("Cache-Control", "no-store");
      return new Response(data, { headers: respHeaders });
    } catch (e) {
      console.error("Bundle fetch error:", e);
      return new Response(JSON.stringify({ error: "Bundle unavailable" }), { status: 500, headers });
    }
  }

  // ---------- PUBLIC: Submit Answers ----------
  if (url.pathname === "/api/submit" && req.method === "POST") {
    if (!(await checkRateLimit(ip, 30, 60))) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers });
    }
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return new Response(JSON.stringify({ error: "Invalid content type" }), { status: 400, headers });
    }
    const contentLen = parseInt(req.headers.get("content-length") || "0");
    if (contentLen > MAX_BODY_SIZE) {
      return new Response(JSON.stringify({ error: "Request too large" }), { status: 413, headers });
    }
    let body: any;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
    }
    const { userId, token, chapter, answers } = body;
    if (!userId || !token || !chapter || !Array.isArray(answers)) {
      return new Response(JSON.stringify({ success: false, error: "Missing fields" }), { status: 400, headers });
    }
    const tokenData = await verifySessionToken(token, JWT_SECRET);
    if (!tokenData || tokenData.userId !== userId) {
      return new Response(JSON.stringify({ success: false, error: "Invalid token" }), { status: 403, headers });
    }
    const sessionEntry = await kv.get<{ userId: string; submitted: boolean }>(["session", tokenData.sessionId]);
    if (!sessionEntry.value) {
      return new Response(JSON.stringify({ success: false, error: "Session expired" }), { status: 403, headers });
    }
    if (sessionEntry.value.submitted) {
      return new Response(JSON.stringify({ success: false, error: "Already submitted" }), { status: 409, headers });
    }
    await kv.set(["session", tokenData.sessionId], { ...sessionEntry.value, submitted: true }, { expireIn: 30 * 60 * 1000 });

    // Store results (optional)
    console.log(JSON.stringify({ event: "submit", userId, chapter, count: answers.length, correlationId }));
    return new Response(JSON.stringify({ success: true, message: "Answers recorded" }), { headers });
  }

  // ---------- ADMIN: Generate MCQs (QStash / Admin Key) ----------
  if (url.pathname === "/api/admin/generate" && req.method === "POST") {
    const adminKey = req.headers.get("x-admin-key") || "";
    if (adminKey !== ADMIN_KEY) {
      const qstashValid = await verifyQStashSignature(req);
      if (!qstashValid) {
        await logAudit("ADMIN_GENERATE_UNAUTHORIZED", ip);
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
      }
    }
    try {
      const { rows: tasks } = await dbQueryWithTimeout(
        `SELECT * FROM generation_tasks WHERE status = 'pending' AND generated_count < target_count ORDER BY created_at ASC LIMIT 1`,
        []
      );
      if (tasks.length === 0) {
        return new Response(JSON.stringify({ message: "No pending tasks" }), { headers });
      }
      const task = tasks[0];
      if (!(await tryLockTask(task.id))) {
        return new Response(JSON.stringify({ message: "Task already being processed" }), { headers });
      }
      await db.execute({
        sql: "UPDATE generation_tasks SET status = 'in_progress', updated_at = ? WHERE id = ?",
        args: [Date.now(), task.id],
      });
      const batchSize = Math.min(100, task.target_count - task.generated_count);
      let generated = 0;
      try {
        generated = await generateAndStoreMCQs(task.subject, task.chapter, batchSize);
      } catch (err) {
        await db.execute({
          sql: `UPDATE generation_tasks SET status = 'pending', retry_count = retry_count + 1, last_error = ?, updated_at = ? WHERE id = ?`,
          args: [err.message, Date.now(), task.id],
        });
        await unlockTask(task.id);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
      }
      const newCount = task.generated_count + generated;
      const newStatus = newCount >= task.target_count ? "completed" : "pending";
      await db.execute({
        sql: "UPDATE generation_tasks SET generated_count = ?, status = ?, updated_at = ? WHERE id = ?",
        args: [newCount, newStatus, Date.now(), task.id],
      });
      await unlockTask(task.id);
      console.log(JSON.stringify({ event: "generation_complete", taskId: task.id, generated }));
      return new Response(JSON.stringify({ success: true, task_id: task.id, generated }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // ---------- ADMIN: Cleanup old audit logs ----------
  if (url.pathname === "/api/admin/cleanup-audit" && req.method === "POST") {
    const adminKey = req.headers.get("x-admin-key") || "";
    if (adminKey !== ADMIN_KEY) {
      const qstashValid = await verifyQStashSignature(req);
      if (!qstashValid) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
      }
    }
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await db.execute({
      sql: "DELETE FROM audit_log WHERE timestamp < ?",
      args: [cutoff],
    });
    return new Response(JSON.stringify({ success: true, message: "Audit logs cleaned" }), { headers });
  }

  return new Response("Not Found", { status: 404, headers });
}

// 🔥 बस इतना ही – Deno.serve बिना किसी port ऑप्शन के
Deno.serve(handleRequest);
