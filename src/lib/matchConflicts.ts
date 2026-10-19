import { prisma } from "@/lib/db";

export interface MatchConflictInput {
  clubId: string;
  matchDate: string;
  matchTime: string;
  durationMinutes: number;
  isHome: boolean;
  excludeMatchId?: string;
}

function startMinutes(date: string, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return Date.parse(`${date}T00:00:00Z`) / 60000 + hours * 60 + minutes;
}

function endTime(time: string, duration: number) {
  const [hours, minutes] = time.split(":").map(Number);
  const total = (hours * 60 + minutes + duration) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export async function getMatchOverlapWarnings(input: MatchConflictInput): Promise<string[]> {
  if (!input.isHome) return [];
  const day = Date.parse(`${input.matchDate}T00:00:00Z`);
  const matches = await prisma.clubMatch.findMany({
    where: {
      clubId: input.clubId,
      isHome: true,
      matchDate: { gte: new Date(day - 86400000).toISOString().slice(0, 10), lte: new Date(day + 86400000).toISOString().slice(0, 10) },
      ...(input.excludeMatchId ? { id: { not: input.excludeMatchId } } : {}),
    },
    select: { matchDate: true, matchTime: true, durationMinutes: true, opponent: true },
    orderBy: [{ matchDate: "asc" }, { matchTime: "asc" }, { id: "asc" }],
  });
  const start = startMinutes(input.matchDate, input.matchTime);
  return matches.filter((match) => {
    const other = startMinutes(match.matchDate, match.matchTime);
    return start < other + match.durationMinutes && other < start + input.durationMinutes;
  }).map((match) => {
    const date = match.matchDate.split("-").reverse().join(".");
    return `Мачът се застъпва с домакински мач на ${date} от ${match.matchTime} до ${endTime(match.matchTime, match.durationMinutes)} срещу ${match.opponent || "неуточнен съперник"}.`;
  });
}
