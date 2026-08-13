// scripts/build-bundles.ts
import { createClient } from "npm:@libsql/client";
import { gzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";

const db = createClient({
  url: Deno.env.get("TURSO_DATABASE_URL")!,
  authToken: Deno.env.get("TURSO_AUTH_TOKEN")!,
});

export async function buildBundles() {
  console.log("🚀 Starting bundle build...");
  const { rows: chapters } = await db.execute("SELECT DISTINCT chapter FROM mcqs");
  let built = 0;

  for (const row of chapters) {
    const chapter = (row.chapter as string).trim().toLowerCase();
    console.log(`🔨 Building bundle for: ${chapter}...`);

    const { rows: mcqs } = await db.execute({
      sql: `SELECT id, subject, chapter, difficulty, question, option_a, option_b, option_c, option_d, answer, explanation FROM mcqs WHERE LOWER(chapter) = ?`,
      args: [chapter],
    });

    if (mcqs.length === 0) continue;

    const output = mcqs.map((m) => ({
      id: m.id,
      q: m.question,
      options: [m.option_a, m.option_b, m.option_c, m.option_d],
      answer: m.answer,
      exp: m.explanation || "",
      subject: m.subject,
      chapter: m.chapter,
      difficulty: m.difficulty,
    }));

    const json = JSON.stringify(output);
    const compressed = gzip(new TextEncoder().encode(json));
    const checksum = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json))
      .then(hashBuffer => Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join(''));

    await db.execute({
      sql: `INSERT INTO bundles (chapter, version, data, checksum, created_at)
            VALUES (?, (SELECT COALESCE(MAX(version),0)+1 FROM bundles WHERE chapter = ?), ?, ?, ?)
            ON CONFLICT(chapter) DO UPDATE SET
              version = (SELECT version FROM bundles WHERE chapter = ?) + 1,
              data = excluded.data,
              checksum = excluded.checksum,
              created_at = excluded.created_at`,
      args: [chapter, chapter, compressed, checksum, Date.now(), chapter],
    });
    built++;
    console.log(`✅ Bundle updated: ${chapter} (${mcqs.length} MCQs)`);
  }
  console.log(`🎉 Bundle build complete! ${built} chapters built.`);
}

if (import.meta.main) {
  await buildBundles();
}
