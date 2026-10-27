import { optionalPlayerUpdates, PlayerFieldError } from "@/lib/playerFields";
import { resolveMemberFee, feeConflictMessage } from "@/lib/memberFee";
import { FeeSettingsError } from "@/lib/clubFees";
import { NextRequest, NextResponse } from "next/server";
import { prisma, withPrismaPoolRetry } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { randomBytes } from "crypto";
import { publishMemberUpdated } from "@/lib/memberEvents";
import {
  applyCloudinaryTransformToUrl,
  buildCloudinaryUrlFromUploadPath,
} from "@/lib/cloudinaryImagePath";
import {
  getRollingThirtyDayPaymentWindow,
  isCurrentMonthWaived,
  normalizeToMonthStart,
  resolveRollingThirtyDayStatus,
} from "@/lib/paymentStatus";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { parsePaymentAmount } from "@/lib/paymentAmount";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlayerImageRecord = {
  imageUrl: string;
  isAdminView: boolean;
};

function getPrimaryPlayerImagePath(images: PlayerImageRecord[]): string | null {
  const adminImage = images.find((image) => image.isAdminView);
  return adminImage?.imageUrl ?? images[0]?.imageUrl ?? null;
}

function buildAvatarUrlFromPath(imagePath: string | null, cloudName: string): string | null {
  const avatarTransform = "w_320,h_400,c_limit,dpr_auto,f_auto,q_auto:good";
  if (!imagePath) {
    return null;
  }
  if (imagePath.startsWith("http")) {
    return applyCloudinaryTransformToUrl(imagePath, avatarTransform);
  }
  if (!cloudName) {
    return null;
  }
  return buildCloudinaryUrlFromUploadPath(
    imagePath,
    cloudName,
    avatarTransform,
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get("admin_session")?.value;
  const { id } = await params;

  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const player = await prisma.player.findUnique({
      where: { id },
      include: {
        cards: { orderBy: { createdAt: "desc" } },
        paymentLogs: {
          orderBy: { paidAt: "desc" },
        },
        paymentWaivers: {
          orderBy: { waivedFor: "desc" },
        },
        images: true,
        club: {
          select: {
            billingStatus: true,
            paymentWorkflow: true,
            playerFields: true,
          },
        },
      },
    });

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
    const imagePath = getPrimaryPlayerImagePath(player.images);

    const waivedDates = player.paymentWaivers.map((item) => item.waivedFor);
    const pausedThisMonth = isCurrentMonthWaived(waivedDates);
    const resolvedStatus = player.club.paymentWorkflow === "training_credits"
      ? (player.remainingTrainingCredits > 0 ? "paid" : "overdue")
      : player.club.paymentWorkflow === "training_credits_30_days"
        ? player.remainingTrainingCredits > 0 &&
          (getRollingThirtyDayPaymentWindow({ paidDates: player.paymentLogs.map((item) => item.paidFor) })?.remainingDays ?? 0) > 0
            ? "paid"
            : "overdue"
      : player.club.paymentWorkflow === "rolling_30_days"
        ? resolveRollingThirtyDayStatus({
          paidDates: player.paymentLogs.map((item) => item.paidFor),
          firstBillingDate: player.firstBillingMonth,
        })
        : player.status;

    return NextResponse.json({
      ...player,
      status: player.club.paymentWorkflow === "calendar_month" && pausedThisMonth ? "paused" : resolvedStatus,
      imageUrl: imagePath,
      avatarUrl: buildAvatarUrlFromPath(imagePath, cloudName),
      imagePublicId: null,
      isPausedThisMonth: pausedThisMonth,
    });
  } catch (error) {
    console.error("Member fetch error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get("admin_session")?.value;
  const { id } = await params;

  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const firstNameRaw = String(body.firstName ?? "").trim();
    const secondNameRaw = String(body.secondName ?? "").trim();
    const fullNameRaw = String(body.fullName ?? "").trim();
    const fullName = fullNameRaw || [firstNameRaw, secondNameRaw].filter(Boolean).join(" ").trim();
    const clubIdRaw = body.clubId;
    const parentPhoneRaw = body.parentPhone;
    const playerPhoneRaw = body.playerPhone;
    const statusRaw = String(body.status ?? "").trim();
    const birthDateRaw = body.birthDate;
    const avatarUrlRaw = body.avatarUrl;
    const imageUrlRaw = body.imageUrl;
    const hasImageUrl = Object.prototype.hasOwnProperty.call(body, "imageUrl");
    const hasParentPhone = Object.prototype.hasOwnProperty.call(body, "parentPhone");
    const hasPlayerPhone = Object.prototype.hasOwnProperty.call(body, "playerPhone");
    const hasFirstBillingMonth = Object.prototype.hasOwnProperty.call(body, "firstBillingMonth");
    const hasPaymentAmount = Object.prototype.hasOwnProperty.call(body, "paymentAmount");

    if (!fullName) {
      return NextResponse.json(
        { error: "fullName is required" },
        { status: 400 }
      );
    }

    const nextParentPhone = normalizePhone(parentPhoneRaw);
    if (hasParentPhone && nextParentPhone && !isValidPhone(nextParentPhone)) {
      return NextResponse.json({ error: "parentPhone is invalid" }, { status: 400 });
    }
    const nextPlayerPhone = normalizePhone(playerPhoneRaw);
    if (hasPlayerPhone && nextPlayerPhone && !isValidPhone(nextPlayerPhone)) {
      return NextResponse.json({ error: "playerPhone is invalid" }, { status: 400 });
    }

    const existingPlayer = await prisma.player.findUnique({
      where: { id },
      include: {
        images: {
          select: {
            imageUrl: true,
            isAdminView: true,
          },
        },
        club: {
          select: { billingStatus: true },
        },
      },
    });
    if (!existingPlayer) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    const clubId =
      clubIdRaw === null || clubIdRaw === undefined || String(clubIdRaw).trim() === ""
        ? undefined
        : String(clubIdRaw).trim();

    if (clubId) {
      const clubExists = await prisma.club.findUnique({
        where: { id: clubId },
        select: { id: true },
      });
      if (!clubExists) {
        return NextResponse.json({ error: "Club not found" }, { status: 404 });
      }
    }

    const status =
      statusRaw === "paid" || statusRaw === "warning" || statusRaw === "overdue"
        ? statusRaw
        : undefined;
    const birthDate =
      birthDateRaw === null || birthDateRaw === undefined || birthDateRaw === ""
        ? null
        : new Date(String(birthDateRaw));
    if (birthDate && Number.isNaN(birthDate.getTime())) {
      return NextResponse.json({ error: "birthDate is invalid" }, { status: 400 });
    }

    let firstBillingMonthUpdate: Date | null | undefined = undefined;
    if (hasFirstBillingMonth) {
      const fbmRaw = body.firstBillingMonth;
      if (fbmRaw === null || fbmRaw === undefined || String(fbmRaw).trim() === "") {
        if (existingPlayer.club.billingStatus === "active") {
          return NextResponse.json(
            { error: "Cannot clear firstBillingMonth for a player in an active billing club" },
            { status: 400 }
          );
        }
        firstBillingMonthUpdate = null;
      } else {
        const parsed = new Date(`${String(fbmRaw).trim()}-01T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Invalid firstBillingMonth" }, { status: 400 });
        }
        firstBillingMonthUpdate = normalizeToMonthStart(parsed);
      }
    }

    let paymentAmountUpdate: string | undefined = undefined;
    if (hasPaymentAmount) {
      const parsed = parsePaymentAmount(body.paymentAmount);
      if (parsed === null) {
        return NextResponse.json(
          { error: "Invalid paymentAmount. Use a non-negative amount with up to 2 decimals." },
          { status: 400 },
        );
      }
      paymentAmountUpdate = parsed;
    }

    const nextImageUrl = hasImageUrl
      ? imageUrlRaw === null || imageUrlRaw === undefined || String(imageUrlRaw).trim() === ""
        ? null
        : String(imageUrlRaw).trim()
      : undefined;
    const fallbackImageUrl =
      avatarUrlRaw === null || avatarUrlRaw === undefined || String(avatarUrlRaw).trim() === ""
        ? null
        : String(avatarUrlRaw).trim();
    const nextAdminImageUrl = nextImageUrl ?? fallbackImageUrl;
    const currentAdminImagePath = getPrimaryPlayerImagePath(existingPlayer.images);
    const shouldSwitchAdminImage =
      typeof nextAdminImageUrl === "string" &&
      nextAdminImageUrl.length > 0 &&
      nextAdminImageUrl !== currentAdminImagePath;

    const updatedPlayer = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM clubs WHERE id = ${existingPlayer.clubId}::uuid FOR UPDATE`;
      const current = await tx.player.findUniqueOrThrow({ where: { id }, include: { coachGroups: true, club: true } });
      const targetClub = clubId && clubId !== current.clubId ? await tx.club.findUniqueOrThrow({ where: { id: clubId } }) : current.club;
      if (clubId && clubId !== current.clubId && current.coachGroups.length) throw new FeeSettingsError("Премахнете групите на състезателя преди смяна на клуба.");
      if (resolveMemberFee({ ...current, paymentAmount: paymentAmountUpdate ?? current.paymentAmount }, targetClub.defaultPaymentAmount).source === "conflict") {
        throw new FeeSettingsError(feeConflictMessage, 409);
      }
      return tx.player.update({
        where: { id },
        data: {
          fullName,
          ...(clubId ? { clubId } : {}),
          ...optionalPlayerUpdates(body, targetClub),
          ...(hasParentPhone
            ? {
                parentPhone:
                  parentPhoneRaw === null || parentPhoneRaw === undefined || parentPhoneRaw === ""
                    ? null
                    : nextParentPhone,
              }
            : {}),
          ...(hasPlayerPhone
            ? {
                playerPhone:
                  playerPhoneRaw === null || playerPhoneRaw === undefined || playerPhoneRaw === ""
                    ? null
                    : nextPlayerPhone,
              }
            : {}),
          birthDate,
          ...(shouldSwitchAdminImage
            ? {
                images: {
                  updateMany: {
                    where: { isAdminView: true },
                    data: { isAdminView: false },
                  },
                  create: {
                    imageUrl: nextAdminImageUrl,
                    isAdminView: true,
                  },
                },
              }
            : {}),
          ...(status ? { status } : {}),
          ...(firstBillingMonthUpdate !== undefined ? { firstBillingMonth: firstBillingMonthUpdate } : {}),
          ...(paymentAmountUpdate !== undefined ? { paymentAmount: paymentAmountUpdate } : {}),
        },
        include: {
          cards: { orderBy: { createdAt: "desc" } },
          paymentLogs: {
            orderBy: { paidFor: "desc" },
            take: 1,
          },
          club: true,
          images: true,
        },
      });
    });

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
    const imagePath = getPrimaryPlayerImagePath(updatedPlayer.images);
    const activeCardCode =
      updatedPlayer.cards.find((card) => card.isActive)?.cardCode ??
      updatedPlayer.cards[0]?.cardCode;

    if (activeCardCode) {
      publishMemberUpdated(activeCardCode, "member-updated");
      if (status) {
        publishMemberUpdated(activeCardCode, "status-updated");
      }
    }

    return NextResponse.json({
      ...updatedPlayer,
      status: updatedPlayer.club.paymentWorkflow === "training_credits"
        ? (updatedPlayer.remainingTrainingCredits > 0 ? "paid" : "overdue")
        : updatedPlayer.club.paymentWorkflow === "training_credits_30_days"
          ? updatedPlayer.remainingTrainingCredits > 0 &&
            (getRollingThirtyDayPaymentWindow({ paidDates: updatedPlayer.paymentLogs.map((item) => item.paidFor) })?.remainingDays ?? 0) > 0
              ? "paid"
              : "overdue"
        : updatedPlayer.status,
      imageUrl: imagePath,
      avatarUrl: buildAvatarUrlFromPath(imagePath, cloudName),
      imagePublicId: null,
    });
  } catch (error) {
    if (error instanceof PlayerFieldError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof FeeSettingsError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Member update error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get("admin_session")?.value;
  const { id } = await params;

  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = String((body as { action?: unknown })?.action ?? "").trim();

    if (
      action !== "assign_new_card" &&
      action !== "reactivate" &&
      action !== "delete_permanently" &&
      action !== "manage_pause_months"
    ) {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const playerExists = await withPrismaPoolRetry(() =>
      prisma.player.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    if (!playerExists) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    if (action === "reactivate") {
      const reactivatedPlayer = await withPrismaPoolRetry(() => prisma.$transaction(async (tx) => {
        await tx.player.update({
          where: { id },
          data: { isActive: true },
        });

        const latestCard = await tx.card.findFirst({
          where: { playerId: id },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

        if (latestCard) {
          await tx.card.updateMany({
            where: { playerId: id },
            data: { isActive: false },
          });

          await tx.card.update({
            where: { id: latestCard.id },
            data: { isActive: true },
          });
        }

        return tx.player.findUnique({
          where: { id },
          include: {
            cards: { orderBy: { createdAt: "desc" } },
            club: true,
            images: true,
          },
        });
      }));

      if (!reactivatedPlayer) {
        return NextResponse.json({ error: "Player not found" }, { status: 404 });
      }

      const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
      const imagePath = getPrimaryPlayerImagePath(reactivatedPlayer.images);
      return NextResponse.json({
        ...reactivatedPlayer,
        imageUrl: imagePath,
        avatarUrl: buildAvatarUrlFromPath(imagePath, cloudName),
        imagePublicId: null,
      });
    }

    if (action === "delete_permanently") {
      await withPrismaPoolRetry(() => prisma.$transaction([
        prisma.card.deleteMany({
          where: { playerId: id },
        }),
        prisma.player.delete({
          where: { id },
        }),
      ]));

      return NextResponse.json({ success: true, id });
    }

    if (action === "manage_pause_months") {
      const modeRaw = String((body as { mode?: unknown }).mode ?? "").trim().toLowerCase();
      const reasonRaw = String((body as { reason?: unknown }).reason ?? "").trim();
      const monthsRaw = Array.isArray((body as { months?: unknown }).months)
        ? ((body as { months?: unknown[] }).months ?? [])
        : [];

      if (modeRaw !== "pause" && modeRaw !== "remove") {
        return NextResponse.json({ error: "mode must be pause or remove" }, { status: 400 });
      }

      if (monthsRaw.length === 0) {
        return NextResponse.json({ error: "At least one month is required" }, { status: 400 });
      }

      const normalizedMonths: Date[] = [];
      for (const item of monthsRaw) {
        const parsed = new Date(String(item));
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Invalid month value" }, { status: 400 });
        }
        normalizedMonths.push(normalizeToMonthStart(parsed));
      }

      const uniqueByIso = Array.from(
        new Map(normalizedMonths.map((date) => [date.toISOString(), date])).values(),
      );

      const tokenPayload = await verifyAdminToken(token);
      const createdBy = tokenPayload?.roles.includes("coach") ? "coach" : "admin";

      await withPrismaPoolRetry(() => prisma.$transaction(async (tx) => {
        if (modeRaw === "pause") {
          await tx.paymentWaiver.createMany({
            data: uniqueByIso.map((waivedFor) => ({
              playerId: id,
              waivedFor,
              reason: reasonRaw || null,
              createdBy,
            })),
            skipDuplicates: true,
          });
        } else {
          await tx.paymentWaiver.deleteMany({
            where: {
              playerId: id,
              waivedFor: { in: uniqueByIso },
            },
          });
        }

      }));

      const [paymentWaivers, cards, player] = await withPrismaPoolRetry(() =>
        Promise.all([
          prisma.paymentWaiver.findMany({
            where: { playerId: id },
            orderBy: { waivedFor: "desc" },
          }),
          prisma.card.findMany({
            where: { playerId: id, isActive: true },
            select: { cardCode: true },
            take: 1,
          }),
          prisma.player.findUnique({
            where: { id },
            select: {
              status: true,
              remainingTrainingCredits: true,
              firstBillingMonth: true,
              paymentLogs: {
                orderBy: { paidFor: "desc" },
                take: 1,
                select: { paidFor: true },
              },
              club: {
                select: { paymentWorkflow: true },
              },
            },
          }),
        ]),
      );

      const pausedThisMonth = isCurrentMonthWaived(paymentWaivers.map((row) => row.waivedFor));
      const responseStatus = player?.club.paymentWorkflow === "training_credits"
        ? (player.remainingTrainingCredits > 0 ? "paid" : "overdue")
        : player?.club.paymentWorkflow === "training_credits_30_days"
          ? player.remainingTrainingCredits > 0 &&
            (getRollingThirtyDayPaymentWindow({ paidDates: player.paymentLogs.map((item) => item.paidFor) })?.remainingDays ?? 0) > 0
              ? "paid"
              : "overdue"
        : player?.club.paymentWorkflow === "calendar_month" && pausedThisMonth
          ? "paused"
          : (player?.status ?? "paid");
      const targetCardCode = cards[0]?.cardCode;
      if (targetCardCode) {
        publishMemberUpdated(targetCardCode, "status-updated");
        publishMemberUpdated(targetCardCode, "payment-history-updated");
      }

      return NextResponse.json({
        success: true,
        status: responseStatus,
        isPausedThisMonth: pausedThisMonth,
        paymentWaivers,
      });
    }

    let updatedPlayer = null;
    let lastError: unknown = null;

    for (let i = 0; i < 5; i++) {
      const cardCode = randomBytes(4).toString("hex").toUpperCase();
      try {
        updatedPlayer = await withPrismaPoolRetry(() => prisma.$transaction(async (tx) => {
          await tx.card.updateMany({
            where: { playerId: id },
            data: { isActive: false },
          });

          await tx.card.create({
            data: {
              playerId: id,
              cardCode,
              isActive: true,
            },
          });

          return tx.player.findUnique({
            where: { id },
            include: { cards: { orderBy: { createdAt: "desc" } } },
          });
        }));
        break;
      } catch (error) {
        lastError = error;
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code)
            : "";
        if (code !== "P2002") {
          throw error;
        }
      }
    }

    if (!updatedPlayer) {
      throw lastError ?? new Error("Failed to generate unique card code");
    }

    return NextResponse.json(updatedPlayer);
  } catch (error) {
    console.error("Member patch error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const token = request.cookies.get("admin_session")?.value;
    const { id } = await params;

    if (!token || !(await verifyAdminToken(token))) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const player = await withPrismaPoolRetry(() => prisma.player.findUnique({
            where: { id },
            select: { id: true },
        }));

        if (!player) {
            return NextResponse.json({ error: "Player not found" }, { status: 404 });
        }

        await withPrismaPoolRetry(() => prisma.$transaction([
            prisma.card.updateMany({
                where: { playerId: id },
                data: { isActive: false },
            }),
            prisma.player.update({
                where: { id },
                data: { isActive: false },
            }),
        ]));

        return NextResponse.json({ message: "Player removed successfully" });
    } catch (error) {
        console.error("Member remove error:", error);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
