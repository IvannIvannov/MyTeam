import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const clubId = searchParams.get("clubId")?.trim() || null;
  const fromParam = searchParams.get("from")?.trim() || null;
  const toParam = searchParams.get("to")?.trim() || null;

  const fromDate = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : null;
  const toDate = toParam ? new Date(`${toParam}T23:59:59.999Z`) : null;

  const playerWhere = clubId ? { player: { clubId } } : {};
  const dateWhere: Record<string, unknown> = {};
  if (fromDate || toDate) {
    const createdAtFilter: Record<string, Date> = {};
    if (fromDate) createdAtFilter.gte = fromDate;
    if (toDate) createdAtFilter.lte = toDate;
    dateWhere.createdAt = createdAtFilter;
  }

  const where = { ...playerWhere, ...dateWhere };

  // Totals (aggregated for summary cards)
  const grouped = await prisma.partnerDiscountUsage.groupBy({
    by: ["partner", "action"],
    where,
    _count: { id: true },
  });

  const partners = await prisma.partnerDiscount.findMany({
    select: { name: true, logoUrl: true },
    orderBy: { createdAt: "asc" },
  });
  const totals: Record<string, { view: number; copy: number; link_click: number }> = Object.create(null);
  for (const p of partners.map((partner) => partner.name)) {
    totals[p] = { view: 0, copy: 0, link_click: 0 };
  }
  for (const row of grouped) {
    if (!totals[row.partner]) totals[row.partner] = { view: 0, copy: 0, link_click: 0 };
    if (totals[row.partner]) {
      if (row.action === "view") totals[row.partner].view += row._count.id;
      else if (row.action === "copy") totals[row.partner].copy += row._count.id;
      else if (row.action === "link_click") totals[row.partner].link_click += row._count.id;
    }
  }

  // Individual records for daily table with exact timestamps
  const records = await prisma.partnerDiscountUsage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: { partner: true, action: true, createdAt: true },
  });

  const daily = records.map((r) => ({
    createdAt: r.createdAt.toISOString(),
    partner: r.partner,
    action: r.action,
  }));

  return NextResponse.json({ totals, daily, partners });
}
