import { NextRequest, NextResponse } from "next/server";
import { loadAnomalies, loadCatalog } from "@/lib/catalog";
import { toFixtureView } from "@/lib/fixtures";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const catalog = await loadCatalog();
  const anomaly = (await loadAnomalies())[id] ?? null;
  const f = catalog.fixtures.find((x) => x.id === Number(id));
  if (!f) {
    return NextResponse.json(
      { error: "fixture not found", anomaly },
      { status: 404 },
    );
  }
  return NextResponse.json({
    provider: catalog.provider,
    lookupUrl: catalog.lookupUrl,
    fixture: toFixtureView(f),
    anomaly,
  });
}
