import { NextRequest, NextResponse } from "next/server";
import { loadCatalog } from "@/lib/catalog";
import {
  CATEGORIES,
  toFixtureView,
  type FixtureCategoryId,
} from "@/lib/fixtures";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const catalog = await loadCatalog();
  const category = req.nextUrl.searchParams.get(
    "category",
  ) as FixtureCategoryId | null;
  const statusFilter = req.nextUrl.searchParams.get("status") || "scheduled";
  const sort = req.nextUrl.searchParams.get("sort") || "time"; // time | time_desc | league
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  const league = req.nextUrl.searchParams.get("league");
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") || "100"),
    500,
  );
  const nowSec = Math.floor(Date.now() / 1000);

  let fixtures = catalog.fixtures.map((f) => toFixtureView(f, nowSec));

  if (category && category !== ("all" as FixtureCategoryId)) {
    fixtures = fixtures.filter((f) => f.category === category);
  }
  if (statusFilter !== "all") {
    fixtures = fixtures.filter((f) => f.status === statusFilter);
  }
  if (q) {
    fixtures = fixtures.filter(
      (f) =>
        f.teamA.toLowerCase().includes(q) ||
        f.teamB.toLowerCase().includes(q) ||
        f.league.toLowerCase().includes(q) ||
        f.matchId.includes(q),
    );
  }

  // League options from category/status/search — before the league filter collapses the list.
  const leagues = [...new Set(fixtures.map((f) => f.league))].sort();

  if (league) {
    fixtures = fixtures.filter((f) => f.league === league);
  }

  switch (sort) {
    case "time_desc":
      fixtures.sort((a, b) => b.startTime - a.startTime);
      break;
    case "league":
      fixtures.sort(
        (a, b) => a.league.localeCompare(b.league) || a.startTime - b.startTime,
      );
      break;
    case "time":
    default:
      fixtures.sort((a, b) => a.startTime - b.startTime);
  }

  const total = fixtures.length;
  fixtures = fixtures.slice(0, limit);

  return NextResponse.json({
    provider: catalog.provider,
    lookupUrl: catalog.lookupUrl,
    categories: CATEGORIES,
    leagues,
    fixtures,
    total,
    limit,
    sort,
    meta: catalog.meta,
  });
}
