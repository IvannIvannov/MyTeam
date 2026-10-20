import { expect, it, vi } from "vitest";
import { syncFutureTrainingSessions } from "./trainingSessions";

vi.mock("@/lib/db", () => ({ prisma: {} }));

it.each(["calendar", "training_credits"])("does not enroll a new player into an earlier same-day session during schedule sync (%s)", async (workflow) => {
  const createMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    club: { findUniqueOrThrow: vi.fn().mockResolvedValue({ paymentWorkflow: workflow }) },
    trainingSession: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), deleteMany: vi.fn().mockResolvedValue({ count: 0 }), upsert: vi.fn().mockResolvedValueOnce({ id: "morning" }).mockResolvedValueOnce({ id: "tomorrow" }) },
    trainingSessionPlayer: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    trainingOptOut: { createMany: vi.fn().mockResolvedValue({ count: 0 }), findMany: vi.fn().mockResolvedValue([]) },
    player: { findMany: vi.fn().mockResolvedValue([{ id: "new", fullName: "New", teamGroup: null, createdAt: new Date("2026-10-20T12:00:00Z") }]) },
  };
  await syncFutureTrainingSessions({ tx, clubId: "club", scope: { type: "customGroup", id: "group" }, trainingDates: ["2026-10-20", "2026-10-21"], trainingDateTimes: { "2026-10-20": "10:00", "2026-10-21": "10:00" }, trainingDurationMinutes: 60, trainingFieldId: null, trainingFieldPieceIds: [], todayIso: "2026-10-20" });
  expect(createMany).toHaveBeenCalledTimes(1);
  expect(createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ playerId: "new", trainingSessionId: "tomorrow", present: workflow !== "training_credits" })]);
});
