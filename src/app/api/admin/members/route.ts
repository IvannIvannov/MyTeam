import { NextRequest, NextResponse } from "next/server";
import { prisma, withPrismaPoolRetry } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { randomBytes } from "crypto";
import {
  applyCloudinaryTransformToUrl,
  buildCloudinaryUrlFromUploadPath,
} from "@/lib/cloudinaryImagePath";
import {
  getRollingThirtyDayPaymentWindow,
  normalizeToMonthStart,
  resolveRollingThirtyDayStatus,
} from "@/lib/paymentStatus";
import { normalizePhone } from "@/lib/phone";
import { parsePaymentAmount } from "@/lib/paymentAmount";
import { isCustomTrainingGroupPaletteColor } from "@/lib/customTrainingGroupColors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlayerImageRecord = {
  imageUrl: string;
  isAdminView: boolean;
};

function normalizePlayerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("bg-BG");
}

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

export async function POST(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;

  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const fullNameFromBody = String(body.fullName ?? "").trim();
    const firstName = String(body.firstName ?? "").trim();
    const secondName = String(body.secondName ?? "").trim();
    const fullName = fullNameFromBody || [firstName, secondName].filter(Boolean).join(" ").trim();

    if (!fullName) {
      return NextResponse.json(
        { error: "fullName is required" },
        { status: 400 }
      );
    }

    const parentPhone = normalizePhone(body.parentPhone) || null;
    const playerPhone = normalizePhone(body.playerPhone) || null;

    let clubId = String(body.clubId ?? "").trim();
    if (!clubId) {
      const clubs = await prisma.club.findMany({
        select: { id: true },
        take: 2,
        orderBy: { createdAt: "asc" },
      });
      if (clubs.length === 1) {
        clubId = clubs[0].id;
      } else {
        return NextResponse.json(
          { error: "clubId is required when multiple clubs exist" },
          { status: 400 }
        );
      }
    }

    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, billingStatus: true, firstBillingMonth: true, defaultPaymentAmount: true },
    });
    if (!club) {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }

    const rawFirstBillingMonth = String(body.firstBillingMonth ?? "").trim();
    let resolvedFirstBillingMonth: Date | null = null;
    if (rawFirstBillingMonth) {
      const parsed = new Date(`${rawFirstBillingMonth}-01T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid firstBillingMonth" }, { status: 400 });
      }
      resolvedFirstBillingMonth = normalizeToMonthStart(parsed);
    } else if (club.billingStatus === "active") {
      if (!club.firstBillingMonth) {
        return NextResponse.json(
          { error: "Club billing is active but no default billing start. Provide firstBillingMonth." },
          { status: 400 }
        );
      }
      resolvedFirstBillingMonth = club.firstBillingMonth;
    }

    const rawStatus = String(body.status ?? "paid").trim().toLowerCase();
    const status = rawStatus === "warning" || rawStatus === "overdue" ? rawStatus : "paid";
    const hasPaymentAmount = Object.prototype.hasOwnProperty.call(body, "paymentAmount");
    const paymentAmount = hasPaymentAmount
      ? parsePaymentAmount(body.paymentAmount)
      : club.defaultPaymentAmount.toFixed(2);
    if (paymentAmount === null) {
      return NextResponse.json(
        { error: "Invalid paymentAmount. Use a non-negative amount with up to 2 decimals." },
        { status: 400 },
      );
    }

    const jerseyNumber = body.jerseyNumber ? String(body.jerseyNumber).trim() : null;
    const imageUrl = body.imageUrl ? String(body.imageUrl).trim() : null;
    const avatarUrlInput = body.avatarUrl ? String(body.avatarUrl).trim() : null;
    const adminImagePath = imageUrl || avatarUrlInput || null;

    const parseDate = (value: unknown): Date | null => {
      if (value === null || value === undefined || value === "") {
        return null;
      }
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const birthDateRaw = String(body.birthDate ?? "").trim();
    const birthDate = parseDate(birthDateRaw);

    const confirmDuplicate = body.confirmDuplicate === true;
    if (!confirmDuplicate && birthDate) {
      const duplicateCandidates = await prisma.player.findMany({
        where: {
          clubId,
          birthDate,
          isActive: true,
        },
        select: {
          id: true,
          fullName: true,
          birthDate: true,
        },
      });
      const normalizedFullName = normalizePlayerName(fullName);
      const duplicatePlayer = duplicateCandidates.find(
        (player) => normalizePlayerName(player.fullName) === normalizedFullName,
      );

      if (duplicatePlayer) {
        return NextResponse.json(
          {
            error: "duplicate_player",
            message: "An active player with the same name and birth date already exists.",
            duplicatePlayer,
          },
          { status: 409 },
        );
      }
    }

    const lastPaymentDate = parseDate(body.lastPaymentDate);
    if (body.lastPaymentDate && !lastPaymentDate) {
      return NextResponse.json({ error: "Invalid lastPaymentDate" }, { status: 400 });
    }

    const teamGroup = birthDate ? birthDate.getUTCFullYear() : null;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const rawCoachGroupId = body.coachGroupId != null ? String(body.coachGroupId).trim() : null;
    let coachGroupId: string | null = null;
    if (rawCoachGroupId) {
      if (!uuidRegex.test(rawCoachGroupId)) {
        return NextResponse.json({ error: "Invalid coachGroupId" }, { status: 400 });
      }
      const groupExists = await prisma.coachGroup.findFirst({
        where: { id: rawCoachGroupId, clubId },
        select: { id: true },
      });
      if (!groupExists) {
        return NextResponse.json({ error: "Coach group not found" }, { status: 404 });
      }
      coachGroupId = rawCoachGroupId;
    }
    const coachGroupConnect = coachGroupId ? { connect: [{ id: coachGroupId }] } : undefined;

    let createdPlayer = null;
    let lastError: unknown = null;

    for (let i = 0; i < 5; i++) {
      const cardCode = randomBytes(4).toString("hex").toUpperCase();

      try {
        createdPlayer = await prisma.player.create({
          data: {
            clubId,
            fullName,
            status,
            jerseyNumber,
            parentPhone,
            playerPhone,
            birthDate,
            teamGroup,
            lastPaymentDate,
            coachGroups: coachGroupConnect,
            firstBillingMonth: resolvedFirstBillingMonth,
            paymentAmount,
            ...(adminImagePath
              ? {
                  images: {
                    create: {
                      imageUrl: adminImagePath,
                      isAdminView: true,
                    },
                  },
                }
              : {}),
            cards: {
              create: {
                cardCode,
                isActive: true,
              },
            },
          },
          include: {
            club: true,
            cards: {
              orderBy: { createdAt: "desc" },
            },
            paymentLogs: {
              orderBy: { paidAt: "desc" },
            },
            images: true,
          },
        });
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

    if (!createdPlayer) {
      throw lastError ?? new Error("Failed to generate unique card code");
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
    const imagePath = getPrimaryPlayerImagePath(createdPlayer.images);
    const avatarUrl = buildAvatarUrlFromPath(imagePath, cloudName);

    return NextResponse.json(
      {
        ...createdPlayer,
        imageUrl: imagePath,
        avatarUrl,
        imagePublicId: null,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Player creation error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;

  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const clubId = request.nextUrl.searchParams.get("clubId")?.trim() ?? "";
    let isCustomGroupMode = false;
    if (clubId) {
      if (!uuidRegex.test(clubId)) {
        return NextResponse.json({ error: "Club not found" }, { status: 404 });
      }

      const clubRecord = await prisma.club.findUnique({
        where: { id: clubId },
        select: { id: true, trainingGroupMode: true },
      });

      if (!clubRecord) {
        return NextResponse.json({ error: "Club not found" }, { status: 404 });
      }
      isCustomGroupMode = clubRecord.trainingGroupMode === "custom_group";
    }

    const coachGroupId = request.nextUrl.searchParams.get("coachGroupId")?.trim() ?? "";
    if (coachGroupId) {
      if (!uuidRegex.test(coachGroupId)) {
        return NextResponse.json({ error: "Coach group not found" }, { status: 404 });
      }
      const groupExists = await prisma.coachGroup.findFirst({
        where: { id: coachGroupId, ...(clubId ? { clubId } : {}) },
        select: { id: true },
      });
      if (!groupExists) {
        return NextResponse.json({ error: "Coach group not found" }, { status: 404 });
      }
    }

    const customGroupId = request.nextUrl.searchParams.get("customGroupId")?.trim() ?? "";
    if (customGroupId && !uuidRegex.test(customGroupId)) {
      return NextResponse.json({ error: "Custom group not found" }, { status: 404 });
    }

    const now = new Date();
    const includeAllPaymentWaivers = request.nextUrl.searchParams.get("includeAllPaymentWaivers") === "true";
    const currentMonthStart = normalizeToMonthStart(now);
    const nextMonthStart = new Date(Date.UTC(
      currentMonthStart.getUTCFullYear(),
      currentMonthStart.getUTCMonth() + 1,
      1,
      0,
      0,
      0,
      0,
    ));

    const players = await withPrismaPoolRetry(() =>
      prisma.player.findMany({
      where: {
        ...(clubId ? { clubId } : {}),
        ...(coachGroupId ? { coachGroups: { some: { id: coachGroupId } } } : {}),
        ...(customGroupId ? { customTrainingGroups: { some: { groupId: customGroupId } } } : {}),
      },
      select: {
        id: true,
        clubId: true,
        fullName: true,
        status: true,
        jerseyNumber: true,
        parentPhone: true,
        playerPhone: true,
        birthDate: true,
        teamGroup: true,
        lastPaymentDate: true,
        firstBillingMonth: true,
        paymentAmount: true,
        remainingTrainingCredits: true,
        isActive: true,
        coachGroups: { select: { id: true } },
        customTrainingGroups: {
          select: {
            group: {
              select: { color: true, name: true, coachGroupId: true },
            },
          },
        },
        club: {
          select: {
            id: true,
            name: true,
            paymentWorkflow: true,
          },
        },
        cards: {
          select: {
            cardCode: true,
            isActive: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        paymentLogs: {
          select: {
            id: true,
            paidFor: true,
            paidAt: true,
          },
          orderBy: {
            paidAt: "desc",
          },
        },
        paymentWaivers: {
          where: includeAllPaymentWaivers ? undefined : {
            waivedFor: {
              gte: currentMonthStart,
              lt: nextMonthStart,
            },
          },
          select: {
            waivedFor: true,
          },
          orderBy: {
            waivedFor: "desc",
          },
        },
        images: {
          select: {
            imageUrl: true,
            isAdminView: true,
          },
        },
      },
      orderBy: {
        fullName: "asc",
      },
    }),
    );

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
    const normalizedPlayers = players.map((player) => {
      const imagePath = getPrimaryPlayerImagePath(player.images);
      const waivedDates = player.paymentWaivers
        .map((item) => item.waivedFor)
        .filter((date) => date >= currentMonthStart && date < nextMonthStart);
      const row = player as typeof player & {
        customTrainingGroups?: Array<{ group: { color: string | null; name: string; coachGroupId: string | null } }>;
      };
      const { coachGroups, customTrainingGroups, ...rest } = row;
      const customTrainingGroupColors =
        clubId && isCustomGroupMode && customTrainingGroups
          ? Array.from(
              new Set(
                customTrainingGroups
                  .map((link) => link.group.color)
                  .filter((c): c is string => typeof c === "string" && isCustomTrainingGroupPaletteColor(c)),
              ),
            )
          : [];
      return {
        ...rest,
        coachGroupIds: coachGroups.map((g) => g.id),
        customTrainingGroupColors,
        customTrainingGroupNames: Array.from(new Set(
          (customTrainingGroups ?? [])
            .filter((link) => !coachGroupId || link.group.coachGroupId === coachGroupId)
            .map((link) => link.group.name),
        )).sort((a, b) => a.localeCompare(b, "bg")),
        status: rest.club.paymentWorkflow === "calendar_month" && waivedDates.length > 0
          ? "paused"
          : rest.club.paymentWorkflow === "training_credits"
            ? (rest.remainingTrainingCredits > 0 ? "paid" : "overdue")
            : rest.club.paymentWorkflow === "training_credits_30_days"
              ? rest.remainingTrainingCredits > 0 &&
                (getRollingThirtyDayPaymentWindow({ paidDates: rest.paymentLogs.map((log) => log.paidFor) })?.remainingDays ?? 0) > 0
                  ? "paid"
                  : "overdue"
            : rest.club.paymentWorkflow === "rolling_30_days"
              ? resolveRollingThirtyDayStatus({
                  paidDates: rest.paymentLogs.map((log) => log.paidFor),
                  firstBillingDate: rest.firstBillingMonth,
                })
              : rest.status,
        imageUrl: imagePath,
        avatarUrl: buildAvatarUrlFromPath(imagePath, cloudName),
        imagePublicId: null,
      };
    });

    return NextResponse.json(normalizedPlayers);
  } catch (error) {
    console.error("Players fetch error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
