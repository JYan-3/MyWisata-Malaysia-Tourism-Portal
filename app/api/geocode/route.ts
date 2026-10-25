import { createClient } from "@/lib/supabase/server";
import { apiFail, apiOk } from "@/lib/validation/schemas";
import type { GeoHit } from "@/lib/routing";
import { consumeRouteRateLimit, withRouteProviderSlot } from "@/app/api/route/route-state";

export const dynamic = "force-dynamic";

const MAX_QUERY_LENGTH = 200;
const MAX_RESPONSE_BYTES = 256 * 1024;
const PROVIDER_TIMEOUT_MS = 5_000;

function privateResponse(response: Response) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error("response_too_large");
  if (!response.body) throw new Error("empty_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function isCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export async function GET(request: Request) {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return privateResponse(apiFail("UNAUTHORIZED", "Sign in required", 401));

  const params = new URL(request.url).searchParams;
  const hasLat = params.has("lat");
  const hasLng = params.has("lng");
  if (hasLat || hasLng) {
    const rawLat = params.get("lat");
    const rawLng = params.get("lng");
    if (!hasLat || !hasLng || !rawLat?.trim() || !rawLng?.trim()) {
      return privateResponse(apiFail("VALIDATION_FAILED", "Coordinates must be valid", 422));
    }
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!isCoordinate(lat, -90, 90) || !isCoordinate(lng, -180, 180)) {
      return privateResponse(apiFail("VALIDATION_FAILED", "Coordinates must be valid", 422));
    }
    // Reverse lookup is optional; preserve the map pin without sending coordinates
    // to an unconfigured public geocoding service.
    return privateResponse(apiOk({ results: [{ label: `${lat}, ${lng}`, lat, lng }] }));
  }

  const query = params.get("q")?.trim();
  if (!query || query.length < 3 || query.length > MAX_QUERY_LENGTH || [...params.keys()].some((key) => key !== "q")) {
    return privateResponse(apiFail("VALIDATION_FAILED", "Search query is invalid", 422));
  }

  const key = process.env.ORS_API_KEY;
  if (!key) return privateResponse(apiFail("GEOCODING_UNAVAILABLE", "Place search is temporarily unavailable", 503));
  if (!consumeRouteRateLimit(user.id)) return privateResponse(apiFail("RATE_LIMITED", "Too many place searches", 429));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  const abortRequest = () => controller.abort();
  request.signal.addEventListener("abort", abortRequest, { once: true });
  try {
    const providerParams = new URLSearchParams({ api_key: key, text: query, "boundary.country": "MY", size: "5" });
    const providerResult = await withRouteProviderSlot(async () => {
      const response = await fetch(`https://api.openrouteservice.org/geocode/search?${providerParams.toString()}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("provider_unavailable");
      return readBoundedJson(response);
    }, controller.signal);
    if (providerResult === null) {
      const response = privateResponse(apiFail("PROVIDER_BUSY", "Place search is busy. Please try again shortly.", 503));
      response.headers.set("Retry-After", "2");
      return response;
    }
    const payload = providerResult;
    const features = typeof payload === "object" && payload !== null && "features" in payload && Array.isArray(payload.features)
      ? payload.features
      : [];
    const results = features.flatMap((feature): GeoHit[] => {
      if (typeof feature !== "object" || feature === null || !("geometry" in feature) || !feature.geometry || typeof feature.geometry !== "object" || !("coordinates" in feature.geometry)) return [];
      const coordinates = feature.geometry.coordinates;
      if (!Array.isArray(coordinates) || !isCoordinate(coordinates[0], -180, 180) || !isCoordinate(coordinates[1], -90, 90)) return [];
      const properties = "properties" in feature && typeof feature.properties === "object" && feature.properties !== null ? feature.properties : null;
      const label = properties && "label" in properties && typeof properties.label === "string" ? properties.label.trim().slice(0, 200) : "";
      if (!label) return [];
      return [{ label, lat: coordinates[1], lng: coordinates[0] }];
    }).slice(0, 5);
    return privateResponse(apiOk({ results }));
  } catch {
    return privateResponse(apiFail("GEOCODING_UNAVAILABLE", "Place search is temporarily unavailable", 503));
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortRequest);
  }
}
