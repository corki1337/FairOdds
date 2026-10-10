import { NextRequest, NextResponse } from "next/server";
export function proxy(req: NextRequest) {
  if (req.method === "OPTIONS")
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      },
    });
  return NextResponse.next();
}
export const config = { matcher: "/actions.json" };
