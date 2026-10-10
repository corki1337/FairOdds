import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runKeeper } from "@/lib/server/keeper";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secret || !token) return false;
  const a = Buffer.from(secret),
    b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function handle(req: NextRequest) {
  if (!authorized(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runKeeper());
  } catch {
    return NextResponse.json(
      { error: "Keeper unavailable; check server configuration" },
      { status: 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
