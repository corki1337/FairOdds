import { marketPda } from "@/lib/anchor";
import { NextRequest } from "next/server";
import { reader, describeMatches, ApiError } from "@/lib/server/markets";
import { limit, json, failure } from "@/lib/server/http";
export { OPTIONS } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    await limit(req);
    const take = Number(req.nextUrl.searchParams.get("limit") ?? 20),
      offset = Number(req.nextUrl.searchParams.get("offset") ?? 0);
    if (
      !Number.isInteger(take) ||
      take < 1 ||
      take > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw new ApiError(400, "INVALID_PAGE", "Invalid limit or offset");
    const { program } = reader();
    const all = await (program.account as any).marketState.all([
      { dataSize: (program.account as any).marketState.size },
    ]);
    const status = req.nextUrl.searchParams.get("status");
    const rows = all
      .filter(
        (x: any) =>
          x.publicKey.equals(
            marketPda(
              program.programId,
              BigInt(x.account.matchId.toString()),
            )[0],
          ) &&
          (!status || Object.keys(x.account.status)[0] === status),
      )
      .sort((a: any, b: any) => a.account.matchId.cmp(b.account.matchId));
    const markets = await describeMatches(
      rows.slice(offset, offset + take),
      program,
    );
    return json({
      markets,
      total: rows.length,
      limit: take,
      offset,
      cluster: "devnet",
    });
  } catch (e) {
    return failure(e);
  }
}
