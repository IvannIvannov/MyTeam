import { expect, it, vi } from "vitest";
import { syncFutureTrainingSessions } from "./trainingSessions";

vi.mock("@/lib/db", () => ({ prisma: {} }));

it("does not enroll a new player into an earlier same-day session during schedule sync", async () => {
  const createMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    trainingSession: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), upsert: vi.fn().mockResolvedValueOnce({ id: "morning" }).mockResolvedValueOnce({ id: "tomorrow" }) },
    trainingSessionPlayer: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    trainingOptOut: { findMany: vi.fn().mockResolvedValue([]) },
    player: { findMany: vi.fn().mockResolvedValue([{ id: "new", fullName: "New", teamGroup: null, createdAt: new Date("2026-10-20T12:00:00Z") }]) },
  };
  await syncFutureTrainingSessions({ tx, clubId: "club", scope: { type: "customGroup", id: "group" }, trainingDates: ["2026-10-20", "2026-10-21"], trainingDateTimes: { "2026-10-20": "10:00", "2026-10-21": "10:00" }, trainingDurationMinutes: 60, trainingFieldId: null, trainingFieldPieceIds: [], todayIso: "2026-10-20" });
  expect(createMany.mock.calls[0][0].data).toEqual([]);
  expect(createMany.mock.calls[1][0].data).toEqual([expect.objectContaining({ playerId: "new", trainingSessionId: "tomorrow", present: true })]);
});
