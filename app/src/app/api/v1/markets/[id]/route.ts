import { NextRequest } from "next/server";
import { match, describeMatch } from "@/lib/server/markets";
import { limit, json, failure, RouteContext } from "@/lib/server/http";
export { OPTIONS } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    await limit(req);
    const { id } = await ctx.params;
    const x = await match(id);
    return json(await describeMatch(x.market, x.m, x.program));
  } catch (e) {
    return failure(e);
  }
}
