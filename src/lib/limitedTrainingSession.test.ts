import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLimitedSessionAttendance } from "./limitedTrainingSession";
const mocks = vi.hoisted(() => ({ club: { findUniqueOrThrow: vi.fn() }, player: { findMany: vi.fn() }, trainingSession: { findFirst: vi.fn() }, trainingSessionPlayer: { createMany: vi.fn(), updateMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: mocks }));
const groupId = "10000000-0000-4000-8000-000000000001";
const firstId = "10000000-0000-4000-8000-000000000002";
const secondId = "10000000-0000-4000-8000-000000000003";
describe("limited places and per-session attendance", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.club.findUniqueOrThrow.mockResolvedValue({ paymentWorkflow: "calendar_month" }); mocks.player.findMany.mockResolvedValue([{ id: "player", fullName: "Player", teamGroup: 2015 }]); mocks.trainingSession.findFirst.mockResolvedValue({ id: firstId }); });
  it.each(["training_credits", "training_credits_30_days"])("keeps confirmed reservations separate from attendance for %s", async (paymentWorkflow) => {
    mocks.club.findUniqueOrThrow.mockResolvedValue({ paymentWorkflow });
    await setLimitedSessionAttendance("club", `coach_group:${groupId}:session:${secondId}`, ["player"], true);
    expect(mocks.trainingSessionPlayer.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ present: false })], skipDuplicates: true });
    expect(mocks.trainingSessionPlayer.updateMany).not.toHaveBeenCalled();
  });
  it("enrols a newly added member in the specific session without touching other same-day sessions", async () => {
    expect(await setLimitedSessionAttendance("club", `coach_group:${groupId}:session:${secondId}`, ["player"], true)).toBe(true);
    expect(mocks.trainingSessionPlayer.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ trainingSessionId: secondId, playerId: "player" })], skipDuplicates: true });
    expect(mocks.trainingSessionPlayer.updateMany).toHaveBeenCalledWith({ where: { trainingSessionId: secondId, playerId: { in: ["player"] }, trainingSession: { clubId: "club" } }, data: { present: true, reasonCode: null, reasonText: null } });
  });
  it("keeps legacy place limits attached to the original training rather than the whole day", async () => {
    const date = new Date("2026-10-12T00:00:00Z");
    expect(await setLimitedSessionAttendance("club", `coach_group:${groupId}`, ["player"], false, date)).toBe(true);
    expect(mocks.trainingSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { clubId: "club", scopeKey: `coach_group:${groupId}`, scopeType: "coachGroup", trainingDate: date }, orderBy: { createdAt: "asc" } }));
    expect(mocks.trainingSessionPlayer.updateMany.mock.calls[0][0].where.trainingSessionId).toBe(firstId);
  });
  it("leaves other group types on their established attendance path", async () => {
    expect(await setLimitedSessionAttendance("club", "team_group:2015", ["player"], false)).toBe(false);
    expect(mocks.trainingSessionPlayer.updateMany).not.toHaveBeenCalled();
  });
});
