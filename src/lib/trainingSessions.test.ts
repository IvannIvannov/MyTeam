import { describe, expect, it, vi } from "vitest";
import { syncFutureTrainingSessions } from "./trainingSessions";

vi.mock("@/lib/db", () => ({ prisma: {} }));

describe("legacy training attendance defaults", () => {
  it.each(["calendar_month", "rolling_30_days", "training_credits", "training_credits_30_days"])("uses the %s default and preserves an existing roster on schedule edits", async (paymentWorkflow) => {
    const requiresCheckIn = paymentWorkflow === "training_credits" || paymentWorkflow === "training_credits_30_days";
    const tx = {
      $queryRaw: vi.fn(),
      club: { findUniqueOrThrow: vi.fn().mockResolvedValue({ paymentWorkflow }) },
      trainingSession: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn().mockResolvedValue({ id: "session" }) },
      trainingSessionPlayer: {
        findMany: vi.fn().mockResolvedValue([{ playerId: "existing" }]),
        deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(),
      },
      trainingOptOut: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
      player: { findMany: vi.fn().mockResolvedValue([
        { id: "existing", fullName: "Existing", teamGroup: null },
        { id: "new", fullName: "New", teamGroup: null },
      ]) },
    };
    await syncFutureTrainingSessions({ tx, clubId: "club", scope: { type: "club" }, trainingDates: ["2026-10-20"], trainingDateTimes: {}, trainingDurationMinutes: 60, trainingFieldId: null, trainingFieldPieceIds: [], todayIso: "2026-10-19" });
    expect(tx.trainingSessionPlayer.createMany).toHaveBeenCalledExactlyOnceWith({
      data: [{ trainingSessionId: "session", playerId: "new", playerName: "New", teamGroup: null, present: !requiresCheckIn, reasonCode: null, reasonText: null }], skipDuplicates: true,
    });
    if (requiresCheckIn) expect(tx.trainingOptOut.createMany).toHaveBeenCalledExactlyOnceWith({
      data: [{ playerId: "new", trainingDate: new Date("2026-10-20T00:00:00Z") }], skipDuplicates: true,
    });
    else expect(tx.trainingOptOut.createMany).not.toHaveBeenCalled();
    expect(tx.trainingSessionPlayer.updateMany).not.toHaveBeenCalled();
    expect(tx.trainingSessionPlayer.deleteMany).toHaveBeenCalledWith({ where: { trainingSessionId: "session", playerId: { notIn: ["existing", "new"] }, creditChargedAt: null, attendanceRecorded: false, reasonCode: null, reasonText: null } });
  });
});
