// scripts/build-bundles.ts - Bundle Builder
import { getDb } from "../utils.ts";

async function buildBundles() {
  console.log("🚀 Starting bundle build...");
  const db = getDb();
  
  const chapters = await db.execute({
    sql: `SELECT DISTINCT chapter FROM mcqs`,
  });
  
  console.log(`📚 Found ${chapters.rows.length} chapters.`);
  let built = 0;
  
  for (const row of chapters.rows) {
    const chapter = row.chapter as string;
    console.log(`🔨 Building bundle for: ${chapter}...`);
    
    const mcqs = await db.execute({
      sql: `SELECT * FROM mcqs WHERE chapter = ?`,
      args: [chapter],
    });
    
    if (mcqs.rows.length === 0) {
      console.log(`⚠️ No MCQs for ${chapter}, skipping.`);
      continue;
    }
    
    const jsonData = JSON.stringify(mcqs.rows);
    const compressed = btoa(unescape(encodeURIComponent(jsonData)));
    
    await db.execute({
      sql: `UPDATE bundles SET active = 0 WHERE chapter = ?`,
      args: [chapter],
    });
    
    await db.execute({
      sql: `INSERT INTO bundles (chapter, data, active, created_at) VALUES (?, ?, 1, ?)`,
      args: [chapter, compressed, Date.now()],
    });
    
    built++;
    console.log(`✅ Bundle built for ${chapter} (${mcqs.rows.length} MCQs)`);
  }
  
  console.log(`🎉 Bundle build complete! ${built} chapters built.`);
}

if (import.meta.main) {
  await buildBundles();
}

// ✅ यह Export Line जरूर होनी चाहिए – इसे हटाना मत!
export { buildBundles };
