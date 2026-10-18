type ReportMatch = {
  id: string;
  matchDate: string;
  matchTime: string;
  opponent: string;
  customGroupId: string | null;
  teamGroups: number[];
  players: { playerId: string; present: boolean; reasonCode: string | null; reasonText: string | null }[];
};

type ReportPlayer = {
  id: string;
  fullName: string;
  teamGroup: number | null;
  customTrainingGroups: { groupId: string }[];
};

export function buildMatchAttendanceReport(matches: ReportMatch[], players: ReportPlayer[]) {
  const events: Record<string, { matchId: string; date: string; time: string; opponent: string }> = {};
  const rows = players.map((player) => ({
    id: player.id, fullName: player.fullName, teamGroup: player.teamGroup,
    attendance: {} as Record<string, { present: boolean; reasonCode: string | null; reasonText: string | null }>,
  }));
  for (const match of matches) {
    const key = `${match.matchDate}#${match.id}`;
    const choices = new Map(match.players.map((choice) => [choice.playerId, choice]));
    let included = false;
    players.forEach((player, index) => {
      const eligible = match.customGroupId
        ? player.customTrainingGroups.some((membership) => membership.groupId === match.customGroupId)
        : match.teamGroups.length === 0 || (player.teamGroup !== null && match.teamGroups.includes(player.teamGroup));
      if (!eligible) return;
      included = true;
      const choice = choices.get(player.id);
      rows[index].attendance[key] = {
        present: choice?.present ?? true,
        reasonCode: choice?.reasonCode ?? null,
        reasonText: choice?.reasonText ?? null,
      };
    });
    if (included) events[key] = { matchId: match.id, date: match.matchDate, time: match.matchTime, opponent: match.opponent };
  }
  return {
    trainingDates: Object.keys(events).sort((a, b) => a.slice(0, 10).localeCompare(b.slice(0, 10)) || events[a].time.localeCompare(events[b].time) || a.localeCompare(b)),
    events,
    players: rows.filter((player) => Object.keys(player.attendance).length > 0),
  };
}
