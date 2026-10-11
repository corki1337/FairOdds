import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runKeeper } from "@/lib/server/keeper";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const token =
    req.headers.get("authorization")?.replace(/^Bearer /, "")?.trim() ??
    req.nextUrl.searchParams.get("secret")?.trim();
  if (!secret || !token) return false;
  const a = Buffer.from(secret),
    b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function handle(req: NextRequest) {
  if (!authorized(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const limitParam = req.nextUrl.searchParams.get("limit");
    const timeoutParam = req.nextUrl.searchParams.get("timeout");
    const maxActions = limitParam ? Math.max(1, parseInt(limitParam, 10)) : 10;
    const maxDurationMs = timeoutParam
      ? Math.max(3000, parseInt(timeoutParam, 10))
      : 50000;
    return NextResponse.json(
      await runKeeper(undefined, maxDurationMs, maxActions),
    );
  } catch (err: any) {
    console.error("Keeper run error:", err);
    return NextResponse.json(
      {
        error: "Keeper unavailable; check server configuration",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
