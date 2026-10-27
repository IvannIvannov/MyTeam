import { verifyAdminToken } from "@/lib/adminAuth";
import { parsePlayerFields } from "@/lib/playerFields";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  applyCloudinaryTransformToUrl,
  buildCloudinaryUrlFromUploadPath,
} from "@/lib/cloudinaryImagePath";

export async function GET() {
  try {
    const teams = await prisma.club.findMany({
      orderBy: {
        name: "asc",
      },
    });

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
    const clubLogoTransform = "w_96,h_96,c_limit,f_auto,q_auto:eco";
    const normalizedTeams = teams.map((team) => {
      if (team.imageUrl && cloudName && !team.imageUrl.startsWith("http")) {
        return {
          ...team,
          imageUrl: buildCloudinaryUrlFromUploadPath(team.imageUrl, cloudName, clubLogoTransform),
        };
      }
      if (team.imageUrl && team.imageUrl.startsWith("http")) {
        return {
          ...team,
          imageUrl: applyCloudinaryTransformToUrl(team.imageUrl, clubLogoTransform),
        };
      }
      return team;
    });

    return NextResponse.json(normalizedTeams);
  } catch (error) {
    console.error("Teams fetch error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.roles.includes("admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json();
    const { name, sports, imageUrl, imagePublicId } = body;

    // Validation
    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Team name is required" },
        { status: 400 }
      );
    }

    let playerFields;
    try { playerFields = parsePlayerFields(body.playerFields ?? []); }
    catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }

    // Create new team
    const team = await prisma.club.create({
      data: {
        name: name.trim(),
        playerFields,
        trainingGroupMode: "custom_group",
        sports: typeof sports === "string" && sports.trim() ? sports.trim() : null,
        imageUrl: imageUrl || null,
        imagePublicId: imagePublicId || null,
      },
    });

    return NextResponse.json(team, { status: 201 });
  } catch (error) {
    console.error("Create team error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
