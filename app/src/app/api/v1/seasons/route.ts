import { NextRequest } from "next/server";
import { reader } from "@/lib/server/markets";
import { describeSeason } from "@/lib/server/seasons";
import { limit, json, failure } from "@/lib/server/http";
export { OPTIONS } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    await limit(req);
    const { program } = reader();
    const all = await (program.account as any).seasonMarket.all();
    return json({
      markets: all.map((x: any) =>
        describeSeason(x.publicKey, x.account, program.programId),
      ),
      cluster: "devnet",
    });
  } catch (e) {
    return failure(e);
  }
}
