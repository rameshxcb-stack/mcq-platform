// main.ts - WORKING VERSION
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

serve(async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === "/api/health" && req.method === "GET") {
    return new Response(
      JSON.stringify({ status: "ok", message: "Hello from Deno!" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (url.pathname === "/" && req.method === "GET") {
    return new Response("🚀 Deno Deploy is working!", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("Not Found", { status: 404 });
});
