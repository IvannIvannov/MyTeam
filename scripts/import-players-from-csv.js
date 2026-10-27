/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function parseCsv(content, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];

    if (ch === "\"") {
      if (inQuotes && content[i + 1] === "\"") {
        field += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && content[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += ch;
  }

  row.push(field);
  rows.push(row);

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function normalizeHeader(value) {
  return value.replace(/\uFEFF/g, "").trim().toLowerCase();
}

function findColumnIndex(headers, candidates) {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate.toLowerCase());
    if (idx >= 0) {
      return idx;
    }
  }
  return -1;
}

const NAME_CANDIDATES = ["Име, фамилия", "име, фамилия", "ime, familiya", "fullName", "fullname"];
const BORN_CANDIDATES = ["роден", "родена", "born", "birthdate", "birth_date", "дата на раждане"];
const KIT_CANDIDATES = ["№", "#", "kit", "jersey", "number", "номер"];

function resolveRowsAndDelimiter(content) {
  const commaRows = parseCsv(content, ",");
  const semicolonRows = parseCsv(content, ";");

  const commaHeaders = commaRows[0] || [];
  const semicolonHeaders = semicolonRows[0] || [];

  const commaName = findColumnIndex(commaHeaders, NAME_CANDIDATES);
  const commaBorn = findColumnIndex(commaHeaders, BORN_CANDIDATES);
  const semicolonName = findColumnIndex(semicolonHeaders, NAME_CANDIDATES);
  const semicolonBorn = findColumnIndex(semicolonHeaders, BORN_CANDIDATES);

  if (semicolonName >= 0 && semicolonBorn >= 0) {
    return { rows: semicolonRows, delimiter: ";" };
  }

  if (commaName >= 0 && commaBorn >= 0) {
    return { rows: commaRows, delimiter: "," };
  }

  return semicolonHeaders.length > commaHeaders.length
    ? { rows: semicolonRows, delimiter: ";" }
    : { rows: commaRows, delimiter: "," };
}

function decodeCandidates(buffer) {
  const candidates = [{ encoding: "utf8", text: buffer.toString("utf8") }];
  try {
    const decoded1251 = new TextDecoder("windows-1251").decode(buffer);
    candidates.push({ encoding: "windows-1251", text: decoded1251 });
  } catch {
    // Ignore if runtime doesn't support windows-1251 decoder.
  }
  return candidates;
}

function resolveParsedInput(buffer) {
  const decoded = decodeCandidates(buffer);

  for (const candidate of decoded) {
    const { rows, delimiter } = resolveRowsAndDelimiter(candidate.text);
    const headers = rows[0] || [];
    const nameIndex = findColumnIndex(headers, NAME_CANDIDATES);
    const bornIndex = findColumnIndex(headers, BORN_CANDIDATES);
    if (nameIndex >= 0 && bornIndex >= 0) {
      return {
        rows,
        delimiter,
        encoding: candidate.encoding,
        headers,
        nameIndex,
        bornIndex,
        kitIndex: findColumnIndex(headers, KIT_CANDIDATES),
      };
    }
  }

  const fallback = resolveRowsAndDelimiter(decoded[0].text);
  const headers = fallback.rows[0] || [];
  return {
    rows: fallback.rows,
    delimiter: fallback.delimiter,
    encoding: decoded[0].encoding,
    headers,
    nameIndex: findColumnIndex(headers, NAME_CANDIDATES),
    bornIndex: findColumnIndex(headers, BORN_CANDIDATES),
    kitIndex: findColumnIndex(headers, KIT_CANDIDATES),
  };
}

/**
 * Parse a date string in EU format dd.mm.yyyy into a Date object (UTC midnight).
 * Returns null if the value is empty or unparseable.
 */
function parseBirthDate(raw) {
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

async function resolveClubId(inputClubId) {
  if (inputClubId) {
    const club = await prisma.club.findUnique({
      where: { id: inputClubId },
      select: { id: true, billingStatus: true, firstBillingMonth: true },
    });
    if (!club) {
      throw new Error(`Club not found for id: ${inputClubId}`);
    }
    return club;
  }

  const clubs = await prisma.club.findMany({
    select: { id: true, billingStatus: true, firstBillingMonth: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });

  if (clubs.length !== 1) {
    throw new Error(
      "Multiple clubs detected. Pass clubId as second argument: node scripts/import-players-from-csv.js <csvPath> <clubId>"
    );
  }

  return clubs[0];
}

function calculatePlayerAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  // Birthdates are calendar dates; take today's date in the club's timezone.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(today);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  let age = year - birthDate.getUTCFullYear();
  if (month < birthDate.getUTCMonth() + 1 ||
      (month === birthDate.getUTCMonth() + 1 && day < birthDate.getUTCDate())) age--;
  return age < 0 ? null : age;
}

async function createPlayerWithCard({ clubId, fullName, birthDate, teamGroup, jerseyNumber, firstBillingMonth }) {
  let lastError = null;

  for (let i = 0; i < 5; i += 1) {
    const cardCode = randomBytes(4).toString("hex").toUpperCase();

    try {
      await prisma.player.create({
        data: {
          clubId,
          fullName,
          status: "warning",
          birthDate: birthDate ?? undefined,
          age: calculatePlayerAge(birthDate),
          teamGroup: teamGroup ?? undefined,
          jerseyNumber: jerseyNumber ?? undefined,
          firstBillingMonth: firstBillingMonth ?? undefined,
          cards: {
            create: {
              cardCode,
              isActive: true,
            },
          },
        },
      });
      return;
    } catch (error) {
      lastError = error;
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "P2002") {
        throw error;
      }
    }
  }

  throw lastError || new Error("Failed to generate unique card code.");
}

function parseFirstBillingMonthArg(args) {
  const flag = "--first-billing-month";
  const idx = args.indexOf(flag);
  if (idx >= 0 && args[idx + 1]) {
    return args[idx + 1];
  }
  return null;
}

async function main() {
  const csvArg = process.argv[2];
  const clubArg = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : null;

  if (!csvArg) {
    throw new Error(
      "Usage: node scripts/import-players-from-csv.js <csvPath> [clubId] [--first-billing-month YYYY-MM]"
    );
  }

  const csvPath = path.resolve(process.cwd(), csvArg);
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const rawBuffer = fs.readFileSync(csvPath);
  const { rows, delimiter, encoding, headers, nameIndex, bornIndex, kitIndex } =
    resolveParsedInput(rawBuffer);

  if (rows.length < 2) {
    throw new Error("CSV has no data rows.");
  }

  if (nameIndex < 0) {
    throw new Error(
      `Missing column: "Име, фамилия". Parsed encoding: "${encoding}", delimiter: "${delimiter}". Parsed headers: ${headers.join(" | ")}`
    );
  }

  if (bornIndex < 0) {
    throw new Error(
      `Missing column: "Роден". Parsed encoding: "${encoding}", delimiter: "${delimiter}". Parsed headers: ${headers.join(" | ")}`
    );
  }

  const club = await resolveClubId(clubArg);
  const clubId = club.id;

  // Resolve firstBillingMonth
  const firstBillingMonthArg = parseFirstBillingMonthArg(process.argv);
  let firstBillingMonth = null;

  if (firstBillingMonthArg) {
    const parsed = new Date(`${firstBillingMonthArg}-01T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid --first-billing-month value: "${firstBillingMonthArg}". Use YYYY-MM format.`);
    }
    firstBillingMonth = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
  } else if (club.firstBillingMonth) {
    firstBillingMonth = club.firstBillingMonth;
  } else if (club.billingStatus === "active") {
    throw new Error(
      "Club billing is active but no firstBillingMonth is set. Provide --first-billing-month YYYY-MM."
    );
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const fullName = String(row[nameIndex] || "").trim();
    const bornRaw = String(row[bornIndex] || "").trim();
    const kitRaw = kitIndex >= 0 ? String(row[kitIndex] || "").trim() : "";

    if (!fullName) {
      skipped += 1;
      continue;
    }

    const birthDate = parseBirthDate(bornRaw);
    if (!birthDate && bornRaw) {
      console.warn(`Row ${i + 1}: invalid birth date "${bornRaw}" for "${fullName}", skipped.`);
      failed += 1;
      continue;
    }

    const teamGroup = birthDate ? birthDate.getUTCFullYear() : null;
    const jerseyNumber = kitRaw || null;

    try {
      await createPlayerWithCard({ clubId, fullName, birthDate, teamGroup, jerseyNumber, firstBillingMonth });
      created += 1;
    } catch (error) {
      failed += 1;
      console.error(`Row ${i + 1}: failed to import "${fullName}".`, error);
    }
  }

  console.log(
    `Import completed. Created: ${created}, Skipped: ${skipped}, Failed: ${failed}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
