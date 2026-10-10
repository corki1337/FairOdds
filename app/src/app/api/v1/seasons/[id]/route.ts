import { NextRequest } from "next/server";
import { season, describeSeason } from "@/lib/server/seasons";
import { limit, json, failure, RouteContext } from "@/lib/server/http";
export { OPTIONS } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    await limit(req);
    const { id } = await ctx.params,
      x = await season(id);
    return json(describeSeason(x.market, x.m, x.program.programId));
  } catch (e) {
    return failure(e);
  }
}
