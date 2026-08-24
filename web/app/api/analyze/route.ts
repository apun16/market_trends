import { NextResponse } from "next/server";
import { runAnalysis } from "@/lib/agent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { question?: unknown; from?: unknown; to?: unknown; period?: unknown };
    const run = await runAnalysis({
      question: String(body.question ?? ""),
      from: String(body.from ?? ""),
      to: String(body.to ?? ""),
      period: Number(body.period),
    });
    return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The analysis could not be completed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
