// utils.ts
export function normalizeMCQText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\u0900-\u097F]/g, "")
    .trim();
}

export async function computeHash(text: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function generateNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

export async function hmac(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// Token format: base64(userId:timestamp:sessionId:signature)
export function createSessionToken(userId: string, secret: string): Promise<string> {
  const timestamp = Date.now();
  const sessionId = generateNonce();
  const data = `${userId}:${timestamp}:${sessionId}`;
  return hmac(secret, data).then(sig => btoa(`${data}:${sig}`));
}

export async function verifySessionToken(
  token: string, secret: string, maxAgeMs = 30 * 60 * 1000
): Promise<{ userId: string; sessionId: string } | null> {
  try {
    const decoded = atob(token);
    const parts = decoded.split(':');
    if (parts.length !== 4) return null;
    const [userId, tsStr, sessionId, signature] = parts;
    const timestamp = parseInt(tsStr);
    if (Date.now() - timestamp > maxAgeMs) return null;

    const data = `${userId}:${timestamp}:${sessionId}`;
    const expectedSig = await hmac(secret, data);
    if (!timingSafeEqual(signature, expectedSig)) return null;

    return { userId, sessionId };
  } catch {
    return null;
  }
}

export async function hashIP(ip: string): Promise<string> {
  return await computeHash(ip);
}
