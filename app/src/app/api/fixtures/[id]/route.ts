import { NextRequest, NextResponse } from "next/server";
import raw from "@/data/fixtures.json";
import { toFixtureView, type Fixture } from "@/lib/fixtures";

type Catalog = { provider: string; lookupUrl: string; fixtures: Fixture[] };

const catalog = raw as Catalog;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const f = catalog.fixtures.find((x) => x.id === Number(params.id));
  if (!f) {
    return NextResponse.json({ error: "fixture not found" }, { status: 404 });
  }
  return NextResponse.json({
    provider: catalog.provider,
    lookupUrl: catalog.lookupUrl,
    fixture: toFixtureView(f),
  });
}
