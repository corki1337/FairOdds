import { NextRequest } from "next/server";
import { loadSeasonManifests } from "@/lib/catalog";
import { ApiError } from "@/lib/server/markets";
import { limit, json, failure, RouteContext } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    await limit(req);
    const { id } = await ctx.params,
      m = (await loadSeasonManifests()).find((x) => x.id === id);
    if (!m) throw new ApiError(404, "NOT_FOUND", "Manifest not configured");
    return json(m);
  } catch (e) {
    return failure(e);
  }
}
