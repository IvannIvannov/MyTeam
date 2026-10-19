export type MatchResultSnapshot = { homeScore: number | null; awayScore: number | null };
type MatchDetailsForm = {
  description?: string; category?: string;
  opponent: string; location: string; matchDate: string; matchTime: string;
  durationMinutes: string; isHome: boolean; customGroupId: string | null;
  homeScore: string; awayScore: string;
};

export function buildMatchDetailsUpdate(form: MatchDetailsForm, original: MatchResultSnapshot, canEditResult: boolean) {
  const homeScore = form.homeScore.trim() === "" ? null : Number(form.homeScore);
  const awayScore = form.awayScore.trim() === "" ? null : Number(form.awayScore);
  const resultChanged = homeScore !== original.homeScore || awayScore !== original.awayScore;
  return {
    ...(form.description !== undefined ? { description: form.description } : {}),
    ...(form.category ? { category: form.category } : {}),
    opponent: form.opponent, location: form.location, matchDate: form.matchDate,
    matchTime: form.matchTime, durationMinutes: Number.parseInt(form.durationMinutes || "90", 10),
    isHome: form.isHome, customGroupId: form.customGroupId,
    ...(canEditResult && resultChanged ? {
      homeScore, awayScore, expectedResult: original,
    } : {}),
  };
}
