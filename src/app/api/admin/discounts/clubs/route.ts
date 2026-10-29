import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";

type ClubChange = { clubId: string; isVisible: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await verifyAdminToken(token);
  if (!session?.roles.includes("admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Невалидни данни." }, { status: 400 }); }
  if (!body || typeof body.partnerId !== "string" || !uuid.test(body.partnerId)
    || !Array.isArray(body.changes) || body.changes.length > 5000
    || !body.changes.every((change: unknown) => change !== null && typeof change === "object"
      && "clubId" in change && typeof change.clubId === "string" && uuid.test(change.clubId)
      && "isVisible" in change && typeof change.isVisible === "boolean")) {
    return NextResponse.json({ error: "Невалидни данни." }, { status: 400 });
  }
  const changes: ClubChange[] = body.changes;
  const partnerId: string = body.partnerId;
  if (new Set(changes.map(change => change.clubId)).size !== changes.length) {
    return NextResponse.json({ error: "Повторени клубове." }, { status: 400 });
  }

  try {
    const partner = await prisma.partnerDiscount.findUnique({ where: { id: partnerId }, select: { id: true } });
    if (!partner) return NextResponse.json({ error: "Партньорът вече не съществува." }, { status: 404 });
    const clubs = await prisma.club.findMany({ where: { id: { in: changes.map(change => change.clubId) } }, select: { id: true } });
    if (clubs.length !== changes.length) return NextResponse.json({ error: "Някой от клубовете вече не съществува. Презаредете страницата." }, { status: 400 });

    // Change only this partner's visibility; preserve other partners and existing order.
    await prisma.$transaction(async tx => {
      for (const change of changes) {
        await tx.teamDiscountConfig.updateMany({
          where: { clubId: change.clubId, discountId: partnerId },
          data: { isVisible: change.isVisible },
        });
        if (change.isVisible) {
          const last = await tx.teamDiscountConfig.aggregate({ where: { clubId: change.clubId, teamGroup: 0 }, _max: { order: true } });
          await tx.teamDiscountConfig.upsert({
            where: { clubId_teamGroup_discountId: { clubId: change.clubId, teamGroup: 0, discountId: partnerId } },
            update: { isVisible: true },
            create: { clubId: change.clubId, teamGroup: 0, discountId: partnerId, isVisible: true, order: (last._max.order ?? -1) + 1 },
          });
        }
      }
    }, { timeout: 30000 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Save partner clubs error:", error);
    return NextResponse.json({ error: "Промените не бяха запазени. Опитайте отново." }, { status: 500 });
  }
}
