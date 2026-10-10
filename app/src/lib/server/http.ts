import { NextRequest, NextResponse } from "next/server";
import { redis, remoteStore } from "../store";
import { ApiError } from "./markets";
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding",
  "Access-Control-Expose-Headers": "x-action-version,x-blockchain-ids",
  "x-action-version": "2.4",
  "x-blockchain-ids": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "Cache-Control": "no-store",
};
const buckets = new Map<string, { count: number; expires: number }>();
export async function limit(req: NextRequest) {
  const key =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (remoteStore()) {
    const bucket = `fairodds:rate:${key}:${Math.floor(Date.now() / 60000)}`;
    const count = await redis([
      "EVAL",
      "local n=redis.call('incr',KEYS[1]); if n==1 then redis.call('expire',KEYS[1],60) end; return n",
      1,
      bucket,
    ]);
    if (count > 60) throw new ApiError(429, "RATE_LIMITED", "Try again later");
    return;
  }
  const now = Date.now();
  if (buckets.size > 10000)
    for (const [k, b] of buckets) if (b.expires < now) buckets.delete(k);
  if (buckets.size > 10000)
    throw new ApiError(429, "RATE_LIMITED", "Try again later");
  const b = buckets.get(key);
  if (!b || b.expires <= now) {
    buckets.set(key, { count: 1, expires: now + 60000 });
    return;
  }
  if (++b.count > 60)
    throw new ApiError(429, "RATE_LIMITED", "Try again later");
}
export async function body(req: NextRequest) {
  if (Number(req.headers.get("content-length")) > 4096)
    throw new ApiError(413, "BODY_TOO_LARGE", "Body is limited to 4096 bytes");
  const stream = req.body?.getReader();
  if (!stream) throw new ApiError(400, "INVALID_JSON", "JSON body required");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await stream.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > 4096) {
      await stream.cancel();
      throw new ApiError(
        413,
        "BODY_TOO_LARGE",
        "Body is limited to 4096 bytes",
      );
    }
    chunks.push(chunk.value);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON object required");
  }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS });
}
export function failure(e: unknown) {
  return e instanceof ApiError
    ? json(
        { error: { code: e.code, message: e.message }, message: e.message },
        e.status,
      )
    : json(
        {
          error: {
            code: "RPC_UNAVAILABLE",
            message: "Could not read the network. Try again.",
          },
          message: "Network unavailable",
        },
        503,
      );
}
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
export type RouteContext = { params: Promise<{ id: string }> };
