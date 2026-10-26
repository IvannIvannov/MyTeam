import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { parsePaymentAmount } from "@/lib/paymentAmount";
import type { PushNotificationPayload } from "@/lib/push/types";
import { deliverSubscriptionNotification, initializeClubSubscription } from "@/lib/clubSubscriptions";
import { SubscriptionError, UUID_PATTERN, isMonth, parseSubscriptionSetup } from "@/lib/clubSubscriptionDomain";
import { subscriptionApiError } from "@/lib/clubSubscriptionApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get("admin_session")?.value;
  const payload = token ? await verifyAdminToken(token) : null;
  if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!payload.roles.includes("admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: clubId } = await params;
    if (!UUID_PATTERN.test(clubId)) throw new SubscriptionError("Невалиден клуб.");
    const raw: unknown = await request.json().catch(() => null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SubscriptionError("Невалидни данни.");
    const body = raw as Record<string, unknown>;
    if (!isMonth(body.firstBillingMonth)) throw new SubscriptionError("Invalid firstBillingMonth format. Use YYYY-MM.");
    const firstBillingMonth = new Date(`${body.firstBillingMonth}-01T00:00:00.000Z`);
    const playerStatus = (["keep", "paid", "warning", "overdue"] as const).includes(body.playerStatus as never)
      ? body.playerStatus as "keep" | "paid" | "warning" | "overdue" : "warning";

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM clubs WHERE id = ${clubId}::uuid FOR UPDATE`;
      if (!rows.length) throw new SubscriptionError("Club not found", 404);
      const club = await tx.club.findUniqueOrThrow({ where: { id: clubId }, select: { billingStatus: true, defaultPaymentAmount: true, platformSubscription: { select: { clubId: true } } } });
      if (club.billingStatus === "active" && body.confirm !== "override") throw new SubscriptionError("Club billing is already active. Include confirm: 'override' to override.", 409);
      const paymentAmount = Object.prototype.hasOwnProperty.call(body, "paymentAmount") ? parsePaymentAmount(body.paymentAmount) : club.defaultPaymentAmount.toFixed(2);
      if (paymentAmount === null) throw new SubscriptionError("Invalid paymentAmount. Use a non-negative amount with up to 2 decimals.");
      let notification: PushNotificationPayload | null = null;
      if (!club.platformSubscription) {
        const setup = body.subscription === undefined ? { mode: "trial" as const, trialEndDate: null } : parseSubscriptionSetup(body.subscription);
        notification = await initializeClubSubscription(tx, clubId, setup, payload.sub);
      }
      const updatedClub = await tx.club.update({ where: { id: clubId }, data: {
        billingStatus: "active", firstBillingMonth, billingActivatedAt: new Date(), defaultPaymentAmount: paymentAmount,
      } });
      await tx.player.updateMany({ where: { clubId }, data: { paymentAmount } });
      const affected = await tx.player.updateMany({ where: { clubId, isActive: true }, data: {
        firstBillingMonth, ...(playerStatus !== "keep" ? { status: playerStatus } : {}),
      } });
      return { club: updatedClub, affectedPlayers: affected.count, notification };
    }, { timeout: 15000 });
    const { notification, ...activation } = result;
    const delivery = await deliverSubscriptionNotification(clubId, notification);
    return NextResponse.json({ ...activation, ...delivery });
  } catch (error) { return subscriptionApiError(error); }
}
