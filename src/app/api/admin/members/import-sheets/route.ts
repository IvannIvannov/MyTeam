import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { getGoogleServiceAccountToken } from "@/lib/googleAuth";
import { randomBytes } from "crypto";
import { normalizeToMonthStart } from "@/lib/paymentStatus";
import { parsePaymentAmount } from "@/lib/paymentAmount";
import { parseAttendanceStartDate } from "@/lib/attendanceStartDate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAME_CANDIDATES = ["Име, фамилия", "ime, familiya", "fullname", "full name", "name"];
const BORN_CANDIDATES = ["роден", "родена", "born", "birthdate", "birth_date", "дата на раждане"];
const KIT_CANDIDATES = ["№", "#", "kit", "jersey", "number", "номер"];

export type ParsedPlayerRow = {
  rowIndex: number;
  fullName: string;
  birthDateIso: string | null;
  teamGroup: number | null;
  jerseyNumber: string | null;
  attendanceStartedAtIso?: string | null;
  warning?: string;
};

function normalizeHeader(v: string) {
  return v.replace(/\uFEFF/g, "").trim().toLowerCase();
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const c of candidates) {
    const idx = normalized.indexOf(c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseBirthDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function parseSheetRows(values: string[][]): { rows: ParsedPlayerRow[]; error?: string } {
  if (!values || values.length < 2) {
    return { rows: [], error: "Таблицата няма данни." };
  }

  const headers = values[0].map(String);
  const nameIndex = findColumnIndex(headers, NAME_CANDIDATES);
  const bornIndex = findColumnIndex(headers, BORN_CANDIDATES);
  const kitIndex = findColumnIndex(headers, KIT_CANDIDATES);
  const startIndex = findColumnIndex(headers, ["начална дата на участие", "attendance start", "attendance_started_at"]);

  if (nameIndex < 0) {
    return { rows: [], error: `Не е намерена колона "Име, фамилия". Намерени колони: ${headers.join(", ")}` };
  }
  if (bornIndex < 0) {
    return { rows: [], error: `Не е намерена колона "Роден". Намерени колони: ${headers.join(", ")}` };
  }

  const rows: ParsedPlayerRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const fullName = String(row[nameIndex] ?? "").trim();
    if (!fullName) continue;

    const bornRaw = String(row[bornIndex] ?? "").trim();
    const kitRaw = kitIndex >= 0 ? String(row[kitIndex] ?? "").trim() : "";

    const birthDate = parseBirthDate(bornRaw);
    let attendanceStartedAt: Date | null;
    try {
      attendanceStartedAt = parseAttendanceStartDate(startIndex >= 0 ? String(row[startIndex] ?? "") : "");
    } catch (error) {
      return { rows: [], error: `Ред ${i + 1}: ${error instanceof Error ? error.message : "Невалидна начална дата"}` };
    }
    let warning: string | undefined;
    if (!birthDate && bornRaw) {
      warning = `Невалидна дата "${bornRaw}"`;
    }

    rows.push({
      rowIndex: i + 1,
      fullName,
      birthDateIso: birthDate ? birthDate.toISOString() : null,
      teamGroup: birthDate ? birthDate.getUTCFullYear() : null,
      jerseyNumber: kitRaw || null,
      attendanceStartedAtIso: attendanceStartedAt?.toISOString() ?? null,
      warning,
    });
  }

  return { rows };
}

async function fetchSheetValues(spreadsheetId: string): Promise<string[][]> {
  const accessToken = await getGoogleServiceAccountToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/A1:Z`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Sheets API error (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

async function createPlayerWithCard({
  clubId,
  fullName,
  birthDate,
  teamGroup,
  jerseyNumber,
  firstBillingMonth,
  paymentAmount,
  coachGroupId,
  attendanceStartedAt,
}: {
  clubId: string;
  fullName: string;
  birthDate: Date | null;
  teamGroup: number | null;
  jerseyNumber: string | null;
  firstBillingMonth: Date | null;
  paymentAmount: string;
  coachGroupId: string | null;
  attendanceStartedAt: Date | null;
}) {
  let lastError: unknown = null;
  for (let i = 0; i < 5; i++) {
    const cardCode = randomBytes(4).toString("hex").toUpperCase();
    try {
      await prisma.$transaction(async (tx) => {
        const player = await tx.player.create({
          data: {
            clubId,
            fullName,
            attendanceStartedAt,
            status: "warning",
            birthDate: birthDate ?? undefined,
            teamGroup: teamGroup ?? undefined,
            jerseyNumber: jerseyNumber ?? undefined,
            firstBillingMonth: firstBillingMonth ?? undefined,
            paymentAmount,
            cards: { create: { cardCode, isActive: true } },
            ...(coachGroupId ? { coachGroups: { connect: [{ id: coachGroupId }] } } : {}),
          },
        });
        if (attendanceStartedAt) {
          await tx.attendanceMembership.updateMany({ where: { playerId: player.id, leftAt: null }, data: { joinedAt: attendanceStartedAt } });
        }
      });
      return;
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
      if (code !== "P2002") throw error;
    }
  }
  throw lastError ?? new Error("Failed to generate unique card code.");
}

// GET — preview only, no DB writes
export async function GET(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const spreadsheetId = searchParams.get("spreadsheetId") ?? "";
  if (!spreadsheetId) {
    return NextResponse.json({ error: "spreadsheetId is required" }, { status: 400 });
  }

  const clubId = searchParams.get("clubId") ?? "";
  let clubBillingInfo: { billingStatus: string; firstBillingMonth: Date | null; defaultPaymentAmount: unknown } | null = null;
  if (clubId) {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { billingStatus: true, firstBillingMonth: true, defaultPaymentAmount: true },
    });
    if (club) clubBillingInfo = club;
  }

  try {
    const values = await fetchSheetValues(spreadsheetId);
    const { rows, error } = parseSheetRows(values);
    if (error) return NextResponse.json({ error }, { status: 422 });
    return NextResponse.json({
      rows,
      ...(clubBillingInfo
        ? {
            clubBillingStatus: clubBillingInfo.billingStatus,
            clubFirstBillingMonth: clubBillingInfo.firstBillingMonth,
            clubDefaultPaymentAmount: clubBillingInfo.defaultPaymentAmount,
          }
        : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read sheet" },
      { status: 502 },
    );
  }
}

// POST — import players
export async function POST(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    spreadsheetId?: unknown;
    clubId?: unknown;
    firstBillingMonth?: unknown;
    paymentAmount?: unknown;
    coachGroupId?: unknown;
  };

  const spreadsheetId = String(body.spreadsheetId ?? "").trim();
  const clubId = String(body.clubId ?? "").trim();

  if (!spreadsheetId) return NextResponse.json({ error: "spreadsheetId is required" }, { status: 400 });
  if (!clubId) return NextResponse.json({ error: "clubId is required" }, { status: 400 });

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

  // Verify club exists and fetch billing info
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, billingStatus: true, firstBillingMonth: true, defaultPaymentAmount: true },
  });
  if (!club) return NextResponse.json({ error: "Club not found" }, { status: 404 });

  // Resolve firstBillingMonth for players
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

  const hasPaymentAmount = Object.prototype.hasOwnProperty.call(body, "paymentAmount");
  const paymentAmount = hasPaymentAmount
    ? parsePaymentAmount(body.paymentAmount)
    : "0.00";
  if (paymentAmount === null) {
    return NextResponse.json(
      { error: "Invalid paymentAmount. Use a non-negative amount with up to 2 decimals." },
      { status: 400 },
    );
  }

  try {
    const values = await fetchSheetValues(spreadsheetId);
    const { rows, error } = parseSheetRows(values);
    if (error) return NextResponse.json({ error }, { status: 422 });

    let created = 0;
    let skipped = 0;
    const errors: Array<{ row: number; name: string; reason: string }> = [];

    for (const row of rows) {
      if (row.warning && !row.birthDateIso) {
        skipped++;
        errors.push({ row: row.rowIndex, name: row.fullName, reason: row.warning });
        continue;
      }
      try {
        await createPlayerWithCard({
          clubId,
          fullName: row.fullName,
          birthDate: row.birthDateIso ? new Date(row.birthDateIso) : null,
          teamGroup: row.teamGroup,
          jerseyNumber: row.jerseyNumber,
          firstBillingMonth: resolvedFirstBillingMonth,
          paymentAmount,
          coachGroupId,
          attendanceStartedAt: row.attendanceStartedAtIso ? new Date(row.attendanceStartedAtIso) : null,
        });
        created++;
      } catch (err) {
        errors.push({
          row: row.rowIndex,
          name: row.fullName,
          reason: err instanceof Error ? err.message : "Unknown error",
        });
        skipped++;
      }
    }

    return NextResponse.json({ created, skipped, failed: errors.length, errors });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 502 },
    );
  }
}
