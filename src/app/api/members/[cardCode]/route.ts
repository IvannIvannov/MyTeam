import { optionalPlayerUpdates, playerAgeForBirthDate, PlayerFieldError } from "@/lib/playerFields";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  applyCloudinaryTransformToUrl,
  buildCloudinaryUrlFromUploadPath,
} from "@/lib/cloudinaryImagePath";
import { verifyAdminToken } from "@/lib/adminAuth";
import { cloudinary } from "@/lib/cloudinary";
import { publishMemberUpdated } from "@/lib/memberEvents";
import { isIrisPayEnabledForClub } from "@/lib/irispay";
import { getRollingThirtyDayPaymentWindow, isCurrentMonthWaived, resolveRollingThirtyDayStatus } from "@/lib/paymentStatus";
import { isValidPhone, normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlayerImageRecord = {
  imageUrl: string;
  isAdminView: boolean;
};

function getCloudinaryPublicIdFromImagePath(imagePath: string): string | null {
  const trimmed = imagePath.trim();
  if (!trimmed) {
    return null;
  }

  const uploadMarker = "/upload/";
  const uploadIndex = trimmed.indexOf(uploadMarker);
  const pathWithTransforms = uploadIndex >= 0
    ? trimmed.slice(uploadIndex + uploadMarker.length)
    : trimmed;

  const pathWithoutTransforms = pathWithTransforms.replace(/^v\d+\//, "");
  const pathWithoutExtension = pathWithoutTransforms.replace(/\.[a-z0-9]+$/i, "");
  return pathWithoutExtension || null;
}

function getPlayerImagePathByAudience(
  images: PlayerImageRecord[],
  preferAdminView: boolean,
): string | null {
  if (preferAdminView) {
    const adminImage = images.find((image) => image.isAdminView);
    return adminImage?.imageUrl ?? images[0]?.imageUrl ?? null;
  }

  const nonAdminImage = images.find((image) => !image.isAdminView);
  if (nonAdminImage) {
    return nonAdminImage.imageUrl;
  }

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
  { params }: { params: Promise<{ cardCode: string }> }
) {
  const { cardCode } = await params;
  const normalizedCardCode = cardCode.trim().toUpperCase();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const adminSessionToken = request.cookies.get("admin_session")?.value ?? null;
  const sessionPayload = adminSessionToken ? await verifyAdminToken(adminSessionToken) : null;
  const roles = sessionPayload?.roles ?? [];
  const isPrivilegedViewer = roles.includes("admin") || roles.includes("coach");

  try {
    const card = await prisma.card.findFirst({
      where: {
        cardCode: normalizedCardCode,
        isActive: true,
      },
      include: {
        player: {
          include: {
            club: {
              select: {
                id: true,
                name: true,
                sports: true,
                playerFields: true,
                imageUrl: true,
                emblemUrl: true,
                paymentWorkflow: true,
                defaultOnlineTrainingCredits: true,
                rulesDocuments: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } },
              },
            },
            images: {
              select: {
                imageUrl: true,
                isAdminView: true,
              },
            },
          },
        },
      },
    });

    if (!card) {
      return NextResponse.json(
        { error: "Member not found" },
        {
          status: 404,
          headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
        }
      );
    }

    let notifications: {
      id: string;
      type: string;
      title: string;
      body: string;
      url: string | null;
      sentAt: Date;
      readAt: Date | null;
    }[] = [];
    let unreadCount = 0;

    try {
      const [items, count] = await Promise.all([
        prisma.playerNotification.findMany({
          where: {
            playerId: card.player.id,
            sentAt: {
              gte: oneWeekAgo,
            },
          },
          orderBy: { sentAt: "desc" },
          take: 20,
        }),
        prisma.playerNotification.count({
          where: {
            playerId: card.player.id,
            readAt: null,
            sentAt: {
              gte: oneWeekAgo,
            },
          },
        }),
      ]);
      notifications = items;
      unreadCount = count;
    } catch (notificationError) {
      const code =
        typeof notificationError === "object" &&
        notificationError !== null &&
        "code" in notificationError
          ? String((notificationError as { code?: unknown }).code)
          : "";

      if (code !== "P2021") {
        console.error("Notification history unavailable:", notificationError);
      }
    }

    const [paymentLogs, paymentWaivers] = await Promise.all([
      prisma.paymentLog.findMany({
        where: { playerId: card.player.id },
        orderBy: { paidAt: "desc" },
        select: {
          id: true,
          paidFor: true,
          paidAt: true,
        },
      }),
      prisma.paymentWaiver.findMany({
        where: { playerId: card.player.id },
        orderBy: { waivedFor: "desc" },
        select: {
          id: true,
          waivedFor: true,
          reason: true,
          createdAt: true,
          createdBy: true,
        },
      }),
    ]);

    let configs = await prisma.teamDiscountConfig.findMany({
      where: {
        clubId: card.player.clubId,
        teamGroup: card.player.teamGroup ?? 0,
        isVisible: true,
      },
      include: {
        discount: true,
      },
      orderBy: {
        order: "asc",
      },
    });

    if ((card.player.teamGroup ?? 0) !== 0) {
      const clubConfigs = await prisma.teamDiscountConfig.findMany({
        where: {
          clubId: card.player.clubId,
          teamGroup: 0,
          isVisible: true,
        },
        include: {
          discount: true,
        },
        orderBy: {
          order: "asc",
        },
      });
      // Club assignments apply to every member. Keep the group's ordering and
      // append missing club partners in their configured order.
      const groupDiscountIds = new Set(configs.map(config => config.discount.id));
      configs = [...configs, ...clubConfigs.filter(config => !groupDiscountIds.has(config.discount.id))];
    }

    const assignedDiscounts = configs;
    console.log("ASSIGNED DISCOUNTS JSON:", JSON.stringify(assignedDiscounts, null, 2));

    const waivedDates = paymentWaivers.map((item) => item.waivedFor);
    const pausedThisMonth = isCurrentMonthWaived(waivedDates);
    const paymentWorkflow = card.player.club?.paymentWorkflow ?? "calendar_month";
    const resolvedStatus = paymentWorkflow === "training_credits"
      ? (card.player.remainingTrainingCredits > 0 ? "paid" : "overdue")
      : paymentWorkflow === "training_credits_30_days"
        ? card.player.remainingTrainingCredits > 0 &&
          (getRollingThirtyDayPaymentWindow({ paidDates: paymentLogs.map((item) => item.paidFor) })?.remainingDays ?? 0) > 0
            ? "paid"
            : "overdue"
      : paymentWorkflow === "rolling_30_days"
        ? resolveRollingThirtyDayStatus({
          paidDates: paymentLogs.map((item) => item.paidFor),
          firstBillingDate: card.player.firstBillingMonth,
        })
        : card.player.status;

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
    const playerImagePath = getPlayerImagePathByAudience(card.player.images, isPrivilegedViewer);
    const clubImagePath = card.player.club?.imageUrl ?? null;
    const clubLogoTransform = "w_96,h_96,c_limit,f_auto,q_auto:eco";
    const clubLogoUrl = clubImagePath
      ? clubImagePath.startsWith("http")
        ? applyCloudinaryTransformToUrl(clubImagePath, clubLogoTransform)
        : cloudName
          ? buildCloudinaryUrlFromUploadPath(clubImagePath, cloudName, clubLogoTransform)
          : null
      : card.player.club?.emblemUrl ?? null;

    return NextResponse.json(
      {
        id: card.player.id,
        cardCode: card.cardCode,
        name: card.player.fullName,
        clubId: card.player.club?.id ?? null,
        clubName: card.player.club?.name ?? null,
        clubSports: card.player.club?.sports ?? null,
        clubLogoUrl,
        avatarUrl: buildAvatarUrlFromPath(playerImagePath, cloudName),
        visits_total: 0,
        visits_used: 0,
        isActive: card.isActive,
        team_group: card.player.teamGroup,
        jerseyNumber: card.player.jerseyNumber,
        rank: card.player.rank,
        weight: card.player.weight,
        age: card.player.age,
        playerFields: card.player.club.playerFields,
        parentPhone: card.player.parentPhone,
        playerPhone: card.player.playerPhone,
        birthDate: card.player.birthDate,
        paymentWorkflow,
        onlinePaymentEnabled: isIrisPayEnabledForClub(card.player.club?.id),
        defaultOnlineTrainingCredits: card.player.club?.defaultOnlineTrainingCredits ?? 0,
        clubRulesDocuments: card.player.club?.id === "0d877238-6f51-4ffe-b04f-d285904f5c8b" ? (card.player.club.rulesDocuments ?? []) : [],
        remainingTrainingCredits: card.player.remainingTrainingCredits,
        status: paymentWorkflow === "calendar_month" && pausedThisMonth ? "paused" : resolvedStatus,
        firstBillingMonth: card.player.firstBillingMonth,
        last_payment_date: card.player.lastPaymentDate,
        paymentLogs: paymentLogs.map((item) => ({
          id: item.id,
          paidFor: item.paidFor,
          paidAt: item.paidAt,
        })),
        paymentWaivers: paymentWaivers.map((item) => ({
          id: item.id,
          waivedFor: item.waivedFor,
          reason: item.reason,
          createdAt: item.createdAt,
          createdBy: item.createdBy,
        })),
        isPausedThisMonth: pausedThisMonth,
        notifications: notifications.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          body: item.body,
          url: item.url,
          sentAt: item.sentAt,
          readAt: item.readAt,
        })),
        unread_notifications: unreadCount,
        discounts: assignedDiscounts.map((c) => ({
          id: c.discount.id,
          name: c.discount.name,
          logoUrl: c.discount.logoUrl,
          badgeText: c.discount.badgeText,
          code: c.discount.code,
          storeUrl: c.discount.storeUrl,
          terms: c.discount.terms,
          themeColor: c.discount.themeColor,
        })),
      },
      {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      }
    );
  } catch (error) {
    console.error("Member fetch error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      {
        status: 500,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ cardCode: string }> }
) {
  const { cardCode } = await params;
  const normalizedCardCode = cardCode.trim().toUpperCase();

  try {
    const body = await request.json().catch(() => ({}));

    const hasFullName = Object.prototype.hasOwnProperty.call(body, "fullName");
    const hasBirthDate = Object.prototype.hasOwnProperty.call(body, "birthDate");
    const hasTeamGroup = Object.prototype.hasOwnProperty.call(body, "teamGroup");
    const hasJerseyNumber = Object.prototype.hasOwnProperty.call(body, "jerseyNumber");
    const hasParentPhone = Object.prototype.hasOwnProperty.call(body, "parentPhone");
    const hasPlayerPhone = Object.prototype.hasOwnProperty.call(body, "playerPhone");
    const hasImageUrl = Object.prototype.hasOwnProperty.call(body, "imageUrl");

    if (!hasFullName && !hasBirthDate && !hasTeamGroup && !hasJerseyNumber && !hasParentPhone && !hasPlayerPhone && !hasImageUrl && !("rank" in body) && !("weight" in body)) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }

    const card = await prisma.card.findFirst({
      where: {
        cardCode: normalizedCardCode,
        isActive: true,
      },
      select: {
        playerId: true,
        player: { select: { birthDate: true, club: { select: { playerFields: true } } } },
      },
    });

    if (!card) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const data: {
      age?: number | null;
      rank?: string | null;
      weight?: number | null;
      fullName?: string;
      birthDate?: Date | null;
      teamGroup?: number | null;
      jerseyNumber?: string | null;
      parentPhone?: string | null;
      playerPhone?: string | null;
    } = optionalPlayerUpdates(body, card.player.club);

    if (hasFullName) {
      const nextFullName = String((body as { fullName?: unknown }).fullName ?? "").trim();
      if (!nextFullName) {
        return NextResponse.json({ error: "fullName is required" }, { status: 400 });
      }
      data.fullName = nextFullName;
    }

    if (hasBirthDate) {
      const rawBirthDate = (body as { birthDate?: unknown }).birthDate;
      if (rawBirthDate === null || rawBirthDate === undefined || String(rawBirthDate).trim() === "") {
        data.birthDate = null;
      } else {
        const parsed = new Date(String(rawBirthDate));
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Invalid birthDate" }, { status: 400 });
        }
        data.birthDate = parsed;
      }
    }

    if (hasBirthDate) Object.assign(data, playerAgeForBirthDate(data.birthDate ?? null, card.player.birthDate));

    if (hasParentPhone) {
      const raw = normalizePhone((body as { parentPhone?: unknown }).parentPhone);
      if (!raw) {
        data.parentPhone = null;
      } else if (!isValidPhone(raw)) {
        return NextResponse.json({ error: "Невалиден телефон на родител" }, { status: 400 });
      } else {
        data.parentPhone = raw;
      }
    }

    if (hasPlayerPhone) {
      const raw = normalizePhone((body as { playerPhone?: unknown }).playerPhone);
      if (!raw) {
        data.playerPhone = null;
      } else if (!isValidPhone(raw)) {
        return NextResponse.json({ error: "Невалиден телефон на състезател" }, { status: 400 });
      } else {
        data.playerPhone = raw;
      }
    }

    const nextImageUrl = hasImageUrl
      ? (body as { imageUrl?: unknown }).imageUrl === null ||
        (body as { imageUrl?: unknown }).imageUrl === undefined ||
        String((body as { imageUrl?: unknown }).imageUrl).trim() === ""
        ? null
        : String((body as { imageUrl?: unknown }).imageUrl).trim()
      : null;

    const oldMemberImageUrlsToDelete = await prisma.$transaction(async (tx) => {
      const urlsToDelete: string[] = [];

      if (Object.keys(data).length > 0) {
        await tx.player.update({
          where: {
            id: card.playerId,
          },
          data,
        });
      }

      if (hasImageUrl && nextImageUrl) {
        // Keep admin-view image intact; enforce a single member-view image.
        const memberViewImages = await tx.image.findMany({
          where: {
            playerId: card.playerId,
            isAdminView: false,
          },
          select: {
            id: true,
            imageUrl: true,
          },
          orderBy: {
            id: "asc",
          },
        });

        if (memberViewImages.length === 0) {
          await tx.image.create({
            data: {
              playerId: card.playerId,
              imageUrl: nextImageUrl,
              isAdminView: false,
            },
          });
        } else {
          const [primaryImage, ...duplicateImages] = memberViewImages;
          urlsToDelete.push(primaryImage.imageUrl, ...duplicateImages.map((image) => image.imageUrl));

          await tx.image.update({
            where: {
              id: primaryImage.id,
            },
            data: {
              imageUrl: nextImageUrl,
            },
          });

          if (duplicateImages.length > 0) {
            await tx.image.deleteMany({
              where: {
                id: {
                  in: duplicateImages.map((image) => image.id),
                },
              },
            });
          }
        }
      }

      return urlsToDelete.filter((url) => url.trim() && url !== nextImageUrl);
    });

    for (const oldImageUrl of oldMemberImageUrlsToDelete) {
      const publicId = getCloudinaryPublicIdFromImagePath(oldImageUrl);
      if (!publicId) {
        continue;
      }

      try {
        const result = await cloudinary.uploader.destroy(publicId, {
          resource_type: "image",
          invalidate: true,
        });
        if (result.result !== "ok" && result.result !== "not found") {
          console.warn("Unexpected Cloudinary destroy result:", result);
        }
      } catch (cloudinaryError) {
        console.error("Cloudinary deletion error during public image update:", cloudinaryError);
      }
    }

    publishMemberUpdated(normalizedCardCode, "member-updated");

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PlayerFieldError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Member update error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
