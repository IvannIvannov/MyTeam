import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { parsePaymentAmount } from "@/lib/paymentAmount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  const payload = token ? await verifyAdminToken(token) : null;

  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!payload.roles.includes("admin") && !payload.roles.includes("coach")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id: clubId } = await params;
    const body = await request.json().catch(() => ({}));
    const paymentAmount = parsePaymentAmount((body as { paymentAmount?: unknown }).paymentAmount);

    if (paymentAmount === null) {
      return NextResponse.json(
        { error: "Невалидна сума. Въведете положително число с до 2 знака след десетичната запетая." },
        { status: 400 },
      );
    }

    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true },
    });

    if (!club) {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }

    const [updatedClub, playersResult] = await prisma.$transaction([
      prisma.club.update({
        where: { id: clubId },
        data: { defaultPaymentAmount: paymentAmount },
      }),
      prisma.player.updateMany({
        where: { clubId },
        data: { paymentAmount },
      }),
    ]);

    return NextResponse.json({
      club: updatedClub,
      affectedPlayers: playersResult.count,
    });
  } catch (error) {
    console.error("Payment amount update error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
