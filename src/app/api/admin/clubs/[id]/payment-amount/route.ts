import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";
import { FeeSettingsError, updateClubFees } from "@/lib/clubFees";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: NextRequest, params: Promise<{ id: string }>, preview: boolean) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.roles.some((role) => role === "admin" || role === "coach")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await params;
    const body = preview ? { preview: true } : await request.json();
    return NextResponse.json(await updateClubFees(id, body));
  } catch (error) {
    if (error instanceof FeeSettingsError) return NextResponse.json({ error: error.message, conflicts: error.conflicts }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    console.error("Fee settings error", error);
    return NextResponse.json({ error: "Неуспешно запазване. Обновете данните и опитайте отново." }, { status: 500 });
  }
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { return handle(request, params, true); }
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { return handle(request, params, false); }
