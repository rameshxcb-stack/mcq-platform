// mcq-generator.ts
import { createClient } from "npm:@libsql/client";
import { normalizeMCQText, computeHash } from "./utils.ts";

const db = createClient({
  url: Deno.env.get("TURSO_DATABASE_URL")!,
  authToken: Deno.env.get("TURSO_AUTH_TOKEN")!,
});

// ---------- Quality rating via AI ----------
async function rateMCQsWithAI(mcqs: any[], subject: string, chapter: string): Promise<number[]> {
  const prompt = `Rate the following MCQs on a scale of 0-100 for correctness, clarity, distractor quality, and educational value.
Return ONLY a JSON array of numbers (same order as input).
Subject: ${subject}, Chapter: ${chapter}
MCQs: ${JSON.stringify(mcqs)}`;

  try {
    const key = getRandomKey("GEMINI_KEYS");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${key}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Rating API HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("No rating response");
    const scores = JSON.parse(text);
    if (!Array.isArray(scores) || scores.length !== mcqs.length) throw new Error("Invalid rating array");
    return scores;
  } catch (err) {
    console.error("Rating via Gemini failed, trying DeepSeek:", err.message);
    const key = getRandomKey("DEEPSEEK_KEYS");
    const url = "https://api.deepseek.com/v1/chat/completions";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are an expert MCQ evaluator. Return ONLY a JSON array of scores (0-100)." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`DeepSeek rating HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("No rating response from DeepSeek");
    const scores = JSON.parse(text);
    if (!Array.isArray(scores) || scores.length !== mcqs.length) throw new Error("Invalid rating array");
    return scores;
  }
}

// ---------- Get high-quality examples ----------
async function getHighQualityExamples(subject: string, chapter: string): Promise<any[]> {
  const { rows } = await db.execute({
    sql: `SELECT question, option_a, option_b, option_c, option_d, answer, explanation
          FROM mcqs
          WHERE subject = ? AND chapter = ? AND quality_score > 80
          ORDER BY quality_score DESC
          LIMIT 5`,
    args: [subject, chapter],
  });
  return rows;
}

// ---------- Build generation prompt ----------
function buildGenerationPrompt(subject: string, chapter: string, count: number, examples: any[]): string {
  const examplesText = examples.length > 0
    ? `Here are some high-quality MCQ examples from the same topic. Use their style, difficulty, and structure as a guide:\n${JSON.stringify(examples, null, 2)}\n\n`
    : "";
  return `Generate ${count} multiple-choice questions in **Hinglish** (natural mix of Hindi and English) for subject "${subject}", chapter "${chapter}".
${examplesText}
Each MCQ must follow this EXACT JSON structure (no extra text):
{
  "question": "...",
  "options": ["...", "...", "...", "..."],
  "correct_answer": "...",
  "explanation": "... (5-6 lines in Hinglish, step-by-step reasoning)",
  "difficulty": "Easy/Medium/Hard"
}
- Options must be plausible and clearly one correct.
- Explanation must be detailed and educational.
- Avoid duplicate questions.
Return ONLY a valid JSON array of objects.`;
}

// ---------- Random key ----------
function getRandomKey(envVar: string): string {
  const keys = (Deno.env.get(envVar) || "").split(",").filter(Boolean);
  if (keys.length === 0) throw new Error(`No keys for ${envVar}`);
  return keys[Math.floor(Math.random() * keys.length)];
}

// ---------- Gemini call ----------
async function callGemini(prompt: string): Promise<any[]> {
  const key = getRandomKey("GEMINI_KEYS");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Invalid Gemini response structure");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Gemini did not return an array");
    return parsed;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// ---------- DeepSeek fallback ----------
async function callDeepSeek(prompt: string): Promise<any[]> {
  const key = getRandomKey("DEEPSEEK_KEYS");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const url = "https://api.deepseek.com/v1/chat/completions";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are a helpful assistant that generates MCQs in JSON format. Return only a JSON array." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DeepSeek HTTP ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Invalid DeepSeek response structure");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("DeepSeek did not return an array");
    return parsed;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// ---------- Main generation + store ----------
export async function generateAndStoreMCQs(
  subject: string,
  chapter: string,
  count: number
): Promise<number> {
  const examples = await getHighQualityExamples(subject, chapter);
  const prompt = buildGenerationPrompt(subject, chapter, count, examples);

  let raw: any[] = [];
  try {
    raw = await callGemini(prompt);
  } catch (err) {
    console.warn("Gemini generation failed, trying DeepSeek:", err.message);
    raw = await callDeepSeek(prompt);
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("AI returned empty or invalid response");
  }

  const scores = await rateMCQsWithAI(raw, subject, chapter);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avgScore < 80) {
    throw new Error(`Batch quality too low (avg score: ${avgScore.toFixed(1)}). Entire batch rejected.`);
  }

  const newHashes: string[] = [];
  const mcqMap = new Map<string, any>();
  for (const mcq of raw) {
    const hash = await computeHash(normalizeMCQText(mcq.question));
    newHashes.push(hash);
    mcqMap.set(hash, mcq);
  }

  const placeholders = newHashes.map(() => '?').join(',');
  const { rows: existingRows } = await db.execute({
    sql: `SELECT hash FROM mcqs WHERE hash IN (${placeholders})`,
    args: newHashes,
  });
  const existingSet = new Set(existingRows.map(r => r.hash));

  let stored = 0;
  for (const hash of newHashes) {
    if (existingSet.has(hash)) continue;

    const mcq = mcqMap.get(hash);
    const answerIndex = mcq.options.indexOf(mcq.correct_answer);
    if (answerIndex === -1) continue;

    const id = crypto.randomUUID();
    const idx = newHashes.indexOf(hash);
    const score = scores[idx] || 70;

    await db.execute({
      sql: `INSERT INTO mcqs (id, subject, chapter, difficulty, question, option_a, option_b, option_c, option_d, answer, explanation, hash, quality_score, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, subject, chapter, mcq.difficulty || "medium",
        mcq.question, mcq.options[0], mcq.options[1], mcq.options[2], mcq.options[3],
        answerIndex, mcq.explanation, hash, score, Date.now()
      ],
    });
    stored++;
  }
  return stored;
    }
