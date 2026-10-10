import { NextRequest } from "next/server";
import { loadSeasonManifests } from "@/lib/catalog";
import { limit, json, failure } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    await limit(req);
    return json({ manifests: await loadSeasonManifests() });
  } catch (e) {
    return failure(e);
  }
}
