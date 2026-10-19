import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  match: vi.fn(), player: vi.fn(), previous: vi.fn(), upsert: vi.fn(), lock: vi.fn(),
  history: vi.fn(), push: vi.fn(), memberPush: vi.fn(), memberEvent: vi.fn(), attendanceEvent: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  $transaction: async (callback: (tx: unknown) => unknown) => callback({
    $queryRaw: mocks.lock, clubMatch: { findFirst: mocks.match }, player: { findFirst: mocks.player },
    clubMatchPlayer: { findUnique: mocks.previous, upsert: mocks.upsert },
  }),
} }));
vi.mock("@/lib/training", () => ({ getTodayIsoDateInTimeZone: () => "2026-10-17" }));
vi.mock("@/lib/push/adminHistory", () => ({ saveAdminNotificationHistory: mocks.history }));
vi.mock("@/lib/push/adminService", () => ({ sendPushToClubAdmins: mocks.push }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: mocks.memberPush }));
vi.mock("@/lib/memberEvents", () => ({ publishMemberUpdated: mocks.memberEvent }));
vi.mock("@/lib/trainingAttendanceEvents", () => ({ publishTrainingAttendanceUpdated: mocks.attendanceEvent }));

import { changeMatchAttendance } from "@/lib/matchAttendance";

const input = { clubId: "club", matchId: "match", playerId: "player", byCoach: false,
  attendance: { present: false, reasonCode: "sick", reasonText: null } };

describe("game attendance changes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.match.mockResolvedValue({ id: "match", clubId: "club", customGroupId: "group", teamGroups: [], matchDate: "2026-10-17", matchTime: "18:00", opponent: "Opponent", customGroup: { coachGroupId: "coach-group" } });
    mocks.player.mockResolvedValue({ id: "player", fullName: "Player", cards: [{ cardCode: "CARD" }] });
    mocks.previous.mockResolvedValue(null);
  });

  it("limits updates to enabled games today or later and current eligible active players", async () => {
    expect(await changeMatchAttendance(input)).toBe(true);
    expect(mocks.match).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "match", clubId: "club", attendanceEnabled: true, matchDate: { gte: "2026-10-17" } } }));
    expect(mocks.player).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "player", clubId: "club", isActive: true, customTrainingGroups: { some: { groupId: "group" } } } }));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { matchId_playerId: { matchId: "match", playerId: "player" } }, update: input.attendance }));
    expect(mocks.push).toHaveBeenCalledWith("club", expect.any(Object), "coach-group");
    expect(mocks.memberEvent).toHaveBeenCalledWith("CARD", "training-updated");
    expect(mocks.attendanceEvent).toHaveBeenCalledWith("club", "2026-10-17");
  });

  it("rejects unavailable games and ineligible players without saving or notifying", async () => {
    mocks.match.mockResolvedValueOnce(null);
    expect(await changeMatchAttendance(input)).toBe(false);
    expect(mocks.player).not.toHaveBeenCalled();
    mocks.player.mockResolvedValueOnce(null);
    expect(await changeMatchAttendance(input)).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("does not send duplicate notifications for identical attendance", async () => {
    mocks.previous.mockResolvedValue(input.attendance);
    await changeMatchAttendance(input);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("allows coaches to correct past games while keeping the member date restriction", async () => {
    await changeMatchAttendance({ ...input, byCoach: true });
    expect(mocks.match.mock.calls[0][0].where).not.toHaveProperty("matchDate");
    await changeMatchAttendance(input);
    expect(mocks.match.mock.calls[1][0].where.matchDate).toEqual({ gte: "2026-10-17" });
  });

  it("saves attendance even when push fails and notifies the member for coach edits", async () => {
    mocks.push.mockRejectedValue(new Error("Push offline"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await changeMatchAttendance({ ...input, byCoach: true })).toBe(true);
    expect(mocks.memberPush).toHaveBeenCalled();
    error.mockRestore();
  });
});
