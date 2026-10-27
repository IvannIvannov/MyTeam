import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import {
  applyCloudinaryTransformToUrl,
  buildCloudinaryUrlFromUploadPath,
} from "@/lib/cloudinaryImagePath";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isTransientPrismaConnectionError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as { code?: unknown };
  const code = typeof maybeError.code === "string" ? maybeError.code : "";
  return code === "P1001" || code === "P2024";
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;

  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let clubs;
    try {
      clubs = await prisma.club.findMany({
        select: {
          id: true,
          name: true,
          sports: true,
          emblemUrl: true,
          imageUrl: true,
          imagePublicId: true,
          reminderDay: true,
          overdueDay: true,
          reminderHour: true,
          reminderMinute: true,
          secondReminderDay: true,
          secondReminderHour: true,
          secondReminderMinute: true,
          thirdReminderDay: true,
          thirdReminderHour: true,
          thirdReminderMinute: true,
          overdueHour: true,
          overdueMinute: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
          trainingGroupMode: true,
          playerFields: true,
          notifyOnCoachVisit: true,
          billingStatus: true,
          paymentWorkflow: true,
          firstBillingMonth: true,
          billingActivatedAt: true,
          defaultPaymentAmount: true,
          createdAt: true,
        },
        orderBy: {
          name: "asc",
        },
      });
    } catch (error) {
      if (!isTransientPrismaConnectionError(error)) {
        throw error;
      }

      await sleep(400);
      clubs = await prisma.club.findMany({
        select: {
          id: true,
          name: true,
          sports: true,
          emblemUrl: true,
          imageUrl: true,
          imagePublicId: true,
          reminderDay: true,
          overdueDay: true,
          reminderHour: true,
          reminderMinute: true,
          secondReminderDay: true,
          secondReminderHour: true,
          secondReminderMinute: true,
          thirdReminderDay: true,
          thirdReminderHour: true,
          thirdReminderMinute: true,
          overdueHour: true,
          overdueMinute: true,
          trainingWeekdays: true,
          trainingWindowDays: true,
          trainingGroupMode: true,
          playerFields: true,
          notifyOnCoachVisit: true,
          billingStatus: true,
          paymentWorkflow: true,
          firstBillingMonth: true,
          billingActivatedAt: true,
          defaultPaymentAmount: true,
          createdAt: true,
        },
        orderBy: {
          name: "asc",
        },
      });
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
    const clubLogoTransform = "w_96,h_96,c_limit,f_auto,q_auto:eco";
    const normalizedClubs = clubs.map((club) => {
      if (club.imageUrl && cloudName && !club.imageUrl.startsWith("http")) {
        return {
          ...club,
          imageUrl: buildCloudinaryUrlFromUploadPath(club.imageUrl, cloudName, clubLogoTransform),
        };
      }
      if (club.imageUrl && club.imageUrl.startsWith("http")) {
        return {
          ...club,
          imageUrl: applyCloudinaryTransformToUrl(club.imageUrl, clubLogoTransform),
        };
      }
      return club;
    });

    return NextResponse.json(normalizedClubs);
  } catch (error) {
    console.error("Clubs fetch error:", error);

    if (isTransientPrismaConnectionError(error)) {
      return NextResponse.json(
        { error: "Database temporarily unavailable. Please retry in a few seconds." },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
