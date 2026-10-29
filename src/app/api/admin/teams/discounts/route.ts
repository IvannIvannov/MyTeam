import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import {
  applyCloudinaryTransformToUrl,
  buildCloudinaryUrlFromUploadPath,
} from "@/lib/cloudinaryImagePath";

type DiscountConfigInput = {
  discountId: string;
  order: number;
  isVisible?: boolean;
};

export async function GET(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await verifyAdminToken(token);
  if (!session || !session.roles.includes("admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // 1. Get all clubs
    const clubs = await prisma.club.findMany({
      select: {
        id: true,
        name: true,
        imageUrl: true,
        emblemUrl: true,
      },
      orderBy: { name: "asc" }
    });

    // This editor saves club-wide assignments. Group overrides must not be
    // flattened into that payload or they duplicate the club's partner IDs.
    const configs = await prisma.teamDiscountConfig.findMany({
      where: { teamGroup: 0 },
      include: {
        discount: true
      },
      orderBy: { order: "asc" }
    });

    // 3. Map configs to clubs (teams)
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
    const clubLogoTransform = "w_120,h_120,c_limit,f_auto,q_auto:eco";

    const teamsWithConfigs = clubs.map(club => {
      let finalLogoUrl = club.imageUrl || club.emblemUrl;

      if (finalLogoUrl && cloudName && !finalLogoUrl.startsWith("http")) {
        finalLogoUrl = buildCloudinaryUrlFromUploadPath(finalLogoUrl, cloudName, clubLogoTransform);
      } else if (finalLogoUrl && finalLogoUrl.startsWith("http")) {
        finalLogoUrl = applyCloudinaryTransformToUrl(finalLogoUrl, clubLogoTransform);
      }

      const teamConfigs = configs.filter(c => c.clubId === club.id);
      return {
        clubId: club.id,
        teamGroup: 0, 
        clubName: club.name,
        clubLogoUrl: finalLogoUrl,
        configs: teamConfigs
      };
    });

    return NextResponse.json(teamsWithConfigs);
  } catch (error) {
    console.error("Fetch teams with discounts error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await verifyAdminToken(token);
  if (!session || !session.roles.includes("admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { clubId, teamGroup, discountConfigs } = body; // discountConfigs is an array of { discountId, order, isVisible }

    if (!clubId || teamGroup === undefined || !Array.isArray(discountConfigs)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Update configs in a transaction
    await prisma.$transaction([
      // Delete existing configs for this team
      prisma.teamDiscountConfig.deleteMany({
        where: { clubId, teamGroup }
      }),
      // Create new configs
      prisma.teamDiscountConfig.createMany({
        data: discountConfigs.map((config: DiscountConfigInput) => ({
          clubId,
          teamGroup,
          discountId: config.discountId,
          order: config.order,
          isVisible: config.isVisible ?? true
        }))
      })
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Update team discounts error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
