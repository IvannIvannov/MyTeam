import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publishDiscountUsage } from "@/lib/discountUsageEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PARTNERS = new Set(["SPORT_DEPOT", "IDB", "NIKO", "DALIDA"]);
const VALID_ACTIONS = new Set(["view", "copy", "link_click"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cardCode: string }> }
) {
  try {
    const { cardCode } = await params;

    const body = await request.json() as { partner?: unknown; action?: unknown };
    const { partner, action } = body;

    if (
      typeof partner !== "string" ||
      typeof action !== "string" ||
      !partner.trim() ||
      !VALID_ACTIONS.has(action)
    ) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const card = await prisma.card.findUnique({
      where: { cardCode },
      select: { playerId: true },
    });

    if (!card) {
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const discount = await prisma.partnerDiscount.findFirst({
      where: { name: partner },
      select: { name: true },
    });
    // Keep accepting the identifiers used by older member pages.
    if (!discount && !VALID_PARTNERS.has(partner)) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const dateString = new Date()
      .toLocaleDateString("sv-SE", { timeZone: "Europe/Sofia" }); // "YYYY-MM-DD"

    await prisma.partnerDiscountUsage.create({
      data: {
        playerId: card.playerId,
        partner,
        action,
        date: new Date(`${dateString}T00:00:00.000Z`),
      },
    });

    publishDiscountUsage();

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
