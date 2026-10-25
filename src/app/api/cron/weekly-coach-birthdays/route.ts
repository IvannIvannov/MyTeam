import { NextRequest, NextResponse } from "next/server";
import { runWeeklyCoachBirthdays } from "@/lib/jobs/weeklyCoachBirthdays";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Missing CRON_SECRET configuration." }, { status: 500 });
  const supplied = request.headers.get("x-cron-secret")?.trim() || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (supplied !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runWeeklyCoachBirthdays();
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (error) { console.error("Weekly coach birthday job failed:", error); return NextResponse.json({ error: "Weekly coach birthday job failed." }, { status: 500 }); }
}
export const GET = handle;
export const POST = handle;
