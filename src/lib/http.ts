import { NextResponse } from "next/server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export function jsonNoStore(
  body: unknown,
  status = 200,
): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}
