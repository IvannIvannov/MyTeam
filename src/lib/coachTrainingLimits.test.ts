import { describe, expect, it, vi } from "vitest";
import { applyCoachTrainingLimits, parseCoachTrainingLimits } from "./coachTrainingLimits";
const session = { id: "morning", date: "2026-10-12", trainingTime: "09:00", trainingDurationMinutes: 60, trainingFieldId: null, trainingFieldPieceIds: [], recurrenceId: null, status: "scheduled", note: "" };
function writer(existing: unknown = null) {
  return { limitedTrainingEvent: { findFirst: vi.fn().mockResolvedValue(existing), create: vi.fn(), delete: vi.fn(), update: vi.fn() }, limitedTrainingRegistration: { findMany: vi.fn().mockResolvedValue([{ playerId: "a" }, { playerId: "b" }, { playerId: "c" }]) }, trainingSessionPlayer: { updateMany: vi.fn() } };
}
describe("session-specific places in the restored wizard", () => {
  it("creating limited places changes attendance only for that training", async () => {
    const tx = writer();
    await applyCoachTrainingLimits(tx as unknown as Parameters<typeof applyCoachTrainingLimits>[0], "club", "group", [session, { ...session, id: "evening" }], [{ sessionId: "morning", maxSpots: 2 }]);
    expect(tx.limitedTrainingEvent.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ scopeKey: "coach_group:group:session:morning", maxSpots: 2 }) });
    expect(tx.trainingSessionPlayer.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { trainingSessionId: "morning" }, data: { present: false, reasonCode: "limited_event", reasonText: null } });
  });
  it("increasing capacity promotes the next registered player within that session", async () => {
    const tx = writer({ id: "event", maxSpots: 1 });
    await applyCoachTrainingLimits(tx as unknown as Parameters<typeof applyCoachTrainingLimits>[0], "club", "group", [session], [{ sessionId: "morning", maxSpots: 2 }]);
    expect(tx.trainingSessionPlayer.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { trainingSessionId: "morning", playerId: "b" }, data: { present: true, reasonCode: null, reasonText: null } });
  });
  it("removing the limit preserves unrelated recorded absence reasons", async () => {
    const tx = writer({ id: "event", maxSpots: 1 });
    await applyCoachTrainingLimits(tx as unknown as Parameters<typeof applyCoachTrainingLimits>[0], "club", "group", [session], [{ sessionId: "morning", maxSpots: null }]);
    expect(tx.trainingSessionPlayer.updateMany).toHaveBeenCalledWith({ where: { trainingSessionId: "morning", reasonCode: "limited_event" }, data: { present: true, reasonCode: null, reasonText: null } });
  });
  it("validates the same place range as the original scheduler", () => {
    expect(() => parseCoachTrainingLimits([{ sessionId: "morning", maxSpots: 0 }])).toThrow();
    expect(() => parseCoachTrainingLimits([{ sessionId: "morning", maxSpots: 201 }])).toThrow();
    expect(parseCoachTrainingLimits([{ sessionId: "morning", maxSpots: null }])).toEqual([{ sessionId: "morning", recurrenceId: undefined, maxSpots: null }]);
  });
});
