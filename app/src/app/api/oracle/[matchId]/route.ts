import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STORE = path.join(process.cwd(), ".oracle-store.json");

type Store = Record<string, { result: number; updatedAt: string }>;

function readStore(): Store {
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8")) as Store;
  } catch {
    return {};
  }
}

function writeStore(data: Store) {
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

/** Switchboard job / demo oracle HTTP source: returns numeric 0|1|2 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { matchId: string } }
) {
  const store = readStore();
  const entry = store[params.matchId];
  if (!entry) {
    return NextResponse.json({ result: null, status: "pending" });
  }
  return NextResponse.json({
    result: entry.result,
    updatedAt: entry.updatedAt,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { matchId: string } }
) {
  const body = await req.json();
  const result = Number(body.result);
  if (![0, 1, 2].includes(result)) {
    return NextResponse.json({ error: "result must be 0, 1, or 2" }, { status: 400 });
  }
  const store = readStore();
  store[params.matchId] = { result, updatedAt: new Date().toISOString() };
  writeStore(store);
  return NextResponse.json(store[params.matchId]);
}
