import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";
import { getOccupiedFieldResources } from "@/lib/trainingFieldConflicts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: clubId } = await params;
  const sp = request.nextUrl.searchParams;

  const datesRaw = sp.get("dates") ?? "";
  const trainingDates = datesRaw
    ? datesRaw.split(",").filter((d) => ISO_DATE_RE.test(d))
    : [];
  if (trainingDates.length === 0) {
    return NextResponse.json({ occupiedResources: [] });
  }

  const trainingDateTimes: Record<string, string> = {};
  const dateTimesRaw = sp.get("dateTimes");
  if (dateTimesRaw) {
    try {
      const parsed: unknown = JSON.parse(dateTimesRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [date, time] of Object.entries(parsed as Record<string, unknown>)) {
          if (ISO_DATE_RE.test(date) && typeof time === "string" && TIME_RE.test(time.trim())) {
            trainingDateTimes[date] = time.trim();
          }
        }
      }
    } catch {
      // ignore malformed dateTimes
    }
  }

  const durationRaw = sp.get("duration");
  const durationParsed = durationRaw !== null ? Number.parseInt(durationRaw, 10) : NaN;
  const trainingDurationMinutes = Number.isInteger(durationParsed) && durationParsed >= 1 && durationParsed <= 1440
    ? durationParsed
    : 60;

  const excludeType = sp.get("excludeType");
  const excludeId = sp.get("excludeId") ?? undefined;
  const excludeTeamGroupRaw = sp.get("excludeTeamGroup");
  const excludeTeamGroupParsed = excludeTeamGroupRaw !== null ? Number.parseInt(excludeTeamGroupRaw, 10) : NaN;
  const excludeTeamGroupsRaw = sp.get("excludeTeamGroups") ?? "";
  const excludeTeamGroups = excludeTeamGroupsRaw
    ? excludeTeamGroupsRaw.split(",").map((v) => Number.parseInt(v, 10)).filter(Number.isInteger)
    : [];

  type ExcludeParam = Parameters<typeof getOccupiedFieldResources>[0]["exclude"];
  let exclude: ExcludeParam;
  if (excludeType === "club") {
    exclude = { type: "club" };
  } else if (excludeType === "teamGroup" && Number.isInteger(excludeTeamGroupParsed)) {
    exclude = { type: "teamGroup", teamGroup: excludeTeamGroupParsed };
  } else if (excludeType === "trainingGroup" && excludeId) {
    exclude = { type: "trainingGroup", id: excludeId };
  } else if (excludeType === "customGroup" && excludeId) {
    exclude = { type: "customGroup", id: excludeId };
  } else if (excludeType === "coachGroup" && excludeId) {
    exclude = { type: "coachGroup", id: excludeId, sessionId: sp.get("excludeSessionId") ?? undefined, sessionIds: sp.has("excludeSessionIds") ? (sp.get("excludeSessionIds") ?? "").split(",") : undefined };
  }

  try {
    const occupiedResources = await getOccupiedFieldResources({
      clubId,
      trainingDates,
      trainingDateTimes,
      trainingDurationMinutes,
      exclude,
      excludeTeamGroups,
    });
    return NextResponse.json({ occupiedResources });
  } catch (error) {
    console.error("Field conflicts GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
