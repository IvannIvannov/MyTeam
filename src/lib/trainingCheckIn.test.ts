import { afterEach, describe, expect, it, vi } from "vitest";
import { chargeTrainingCheckIn, trainingCheckInRange } from "./trainingCheckIn";

vi.mock("@/lib/db", () => ({ prisma: {} }));
afterEach(() => vi.useRealTimers());
describe("training check-in", () => {
  it("uses four Sofia calendar dates across midnight and daylight saving", () => {
    expect(trainingCheckInRange(new Date("2026-10-18T22:30:00Z"))).toEqual({ from: new Date("2026-10-16T00:00:00Z"), to: new Date("2026-10-19T00:00:00Z") });
    expect(trainingCheckInRange(new Date("2026-10-26T00:30:00Z"))).toEqual({ from: new Date("2026-10-23T00:00:00Z"), to: new Date("2026-10-26T00:00:00Z") });
  });
  function setup(charged = false) {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    const player = { id: "player", clubId: "club", remainingTrainingCredits: 2, club: { paymentWorkflow: "training_credits" }, paymentLogs: [] as { paidFor: Date }[] };
    const row = { id: "attendance", present: false, creditChargedAt: charged ? new Date() : null, trainingSession: { id: "session", clubId: "club", scopeType: "coachGroup", status: "scheduled", trainingDate: new Date("2026-10-18T00:00:00Z") } };
    const tx = { player: { findUniqueOrThrow: vi.fn().mockResolvedValue(player), update: vi.fn().mockResolvedValue({ ...player, remainingTrainingCredits: 1 }) }, trainingSessionPlayer: { findUnique: vi.fn().mockResolvedValue(row), update: vi.fn() }, trainingOptOut: { deleteMany: vi.fn() } };
    return { tx, row, player, run: () => chargeTrainingCheckIn(tx as unknown as Parameters<typeof chargeTrainingCheckIn>[0], "player", "session") };
  }
  it("records attendance and deducts one credit", async () => {
    const { tx, run } = setup(); await run();
    expect(tx.player.update).toHaveBeenCalledOnce();
    expect(tx.trainingSessionPlayer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ present: true, attendanceRecorded: true, creditChargedAt: expect.any(Date), reasonCode: null }) }));
  });
  it("restores reversed attendance without a second charge", async () => { const { tx, run } = setup(true); await run(); expect(tx.player.update).not.toHaveBeenCalled(); expect(tx.trainingSessionPlayer.update).toHaveBeenCalledOnce(); });
  it("treats duplicate confirmation as a no-op", async () => { const { tx, row, run } = setup(true); row.present = true; await run(); expect(tx.player.update).not.toHaveBeenCalled(); expect(tx.trainingSessionPlayer.update).not.toHaveBeenCalled(); });
  it("rejects cancelled and out-of-window trainings", async () => { const { row, run } = setup(); row.trainingSession.status = "cancelled"; await expect(run()).rejects.toThrow("не е достъпна"); row.trainingSession.status = "scheduled"; row.trainingSession.trainingDate = new Date("2026-10-15T00:00:00Z"); await expect(run()).rejects.toThrow("не е достъпна"); });
  it("rejects exhausted credits", async () => { const { player, tx, run } = setup(); player.remainingTrainingCredits = 0; await expect(run()).rejects.toThrow("Няма оставащи"); expect(tx.trainingSessionPlayer.update).not.toHaveBeenCalled(); });
  it("requires a currently active 30-day package even for a training before expiry", async () => {
    const { player, tx, run } = setup();
    player.club.paymentWorkflow = "training_credits_30_days";
    player.paymentLogs = [{ paidFor: new Date("2026-09-19T00:00:00Z") }];
    await expect(run()).rejects.toThrow("срок е изтекъл");
    expect(tx.player.update).not.toHaveBeenCalled(); expect(tx.trainingSessionPlayer.update).not.toHaveBeenCalled();
  });
  it("accepts a valid 30-day package", async () => {
    const { player, run } = setup(); player.club.paymentWorkflow = "training_credits_30_days";
    player.paymentLogs = [{ paidFor: new Date("2026-10-01T00:00:00Z") }];
    expect((await run()).charged).toBe(true);
  });
  it("accepts the earliest eligible date and rejects tomorrow", async () => {
    const { row, run } = setup(); row.trainingSession.trainingDate = new Date("2026-10-16T00:00:00Z");
    await expect(run()).resolves.toMatchObject({ changed: true });
    row.trainingSession.trainingDate = new Date("2026-10-20T00:00:00Z");
    await expect(run()).rejects.toThrow("не е достъпна");
  });
});
