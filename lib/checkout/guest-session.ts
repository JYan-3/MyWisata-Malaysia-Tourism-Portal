import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const GUEST_SESSION_SECONDS = 30 * 24 * 60 * 60;
export function hashGuestCredential(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function newGuestCredential(): string { return randomBytes(32).toString("base64url"); }
export function guestCookieName(request: Request, order = false): string {
  return `${new URL(request.url).protocol === "https:" ? "__Host-" : ""}mywisata-${order ? "order-access" : "guest"}`;
}
export function readGuestCookie(request: Request, order = false): string | null {
  const name = guestCookieName(request, order);
  const raw = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
}
export function setGuestCookie(response: NextResponse, request: Request, token: string, order = false) {
  response.cookies.set(guestCookieName(request, order), token, {
    httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", path: "/",
    maxAge: order ? 24 * 60 * 60 : GUEST_SESSION_SECONDS,
  });
}
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin && !["cross-site", "none"].includes(request.headers.get("sec-fetch-site") ?? "");
}
export function privateCheckoutJson(payload: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
export function guestPrivateResponse(data: unknown, status = 200): NextResponse {
  return privateCheckoutJson({ data, error: null }, { status });
}

export async function createGuestSession(request: Request): Promise<NextResponse> {
  const token = newGuestCredential();
  const { error } = await createServiceClient().from("guest_checkout_subjects").insert({
    token_hash: hashGuestCredential(token), expires_at: new Date(Date.now() + GUEST_SESSION_SECONDS * 1000).toISOString(),
  });
  if (error) return NextResponse.json({ data: null, error: { code: "GUEST_SESSION_UNAVAILABLE", message: "Guest checkout is temporarily unavailable." } }, { status: 503 });
  const response = guestPrivateResponse({ ready: true });
  setGuestCookie(response, request, token);
  return response;
}
export async function resolveGuestSession(request: Request): Promise<{ guestSubjectId: string } | null> {
  const token = readGuestCookie(request);
  if (!token) return null;
  const { data, error } = await createServiceClient().from("guest_checkout_subjects").select("id")
    .eq("token_hash", hashGuestCredential(token)).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  return !error && data ? { guestSubjectId: data.id as string } : null;
}
export async function reserveGuestRateLimit(key: string, maximum: number, seconds: number): Promise<boolean> {
  const { data, error } = await createServiceClient().rpc("reserve_guest_rate_limit", {
    p_key_hash: hashGuestCredential(key), p_limit: maximum, p_window_seconds: seconds,
  });
  return !error && data === true;
}
export function guestAddressRateKey(request: Request): string {
  // Only trust the address injected by the configured hosting platform. Other
  // deployments share a conservative fallback bucket, never caller-provided IPs.
  const address = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : null;
  return `guest-address:${address ?? "unavailable"}`;
}
export async function readGuestJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > 32768 || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return null; }
  finally { reader.releaseLock(); }
}
