import { getTrainingDateTimeMs } from "@/lib/memberScheduleCountdown";

export type MatchTiming = { matchDate: string; matchTime: string; durationMinutes: number };
export function getMatchOutcome(match: { homeScore: number | null; awayScore: number | null; isHome: boolean }): "win" | "loss" | "draw" | "unset" {
  if (match.homeScore === null || match.awayScore === null) return "unset";
  const difference = match.isHome ? match.homeScore - match.awayScore : match.awayScore - match.homeScore;
  return difference > 0 ? "win" : difference < 0 ? "loss" : "draw";
}
export function hasMatchFinished(match: MatchTiming, now = Date.now()) {
  const start = getTrainingDateTimeMs(match.matchDate, match.matchTime);
  return Number.isFinite(start) && Number.isFinite(match.durationMinutes) && match.durationMinutes > 0 && start + match.durationMinutes * 60_000 <= now;
}

export function parseMatchResult(body: Record<string, unknown>): { homeScore: number | null; awayScore: number | null } | { error: string } {
  if (body.homeScore === null && body.awayScore === null) return { homeScore: null, awayScore: null };
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 999;
  if (!valid(body.homeScore) || !valid(body.awayScore)) return { error: "Въведете голове за домакина и госта (цели числа от 0 до 999)." };
  return { homeScore: body.homeScore, awayScore: body.awayScore };
}

export function formatMatchResult(match: { homeScore: number | null; awayScore: number | null }) {
  return match.homeScore !== null && match.awayScore !== null ? `${match.homeScore} : ${match.awayScore}` : "Не е зададен резултат";
}
