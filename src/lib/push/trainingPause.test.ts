import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTrainingNotificationPaused } from "./trainingPause";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { paymentWaiver: { findMany: mocks.findMany } } }));

describe("training notification pauses", () => {
  beforeEach(() => {
    mocks.findMany.mockReset().mockResolvedValue([]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T22:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("suppresses a training in a waived month, including Bulgarian dates", async () => {
    mocks.findMany.mockResolvedValue([{ waivedFor: new Date("2026-11-01T00:00:00Z") }]);
    for (const trainingDate of ["2026-11-12", "12.11.2026"]) {
      expect(await isTrainingNotificationPaused("player", {
        title: "Training", body: "Reminder", data: { type: "training_reminder", trainingDate },
      })).toBe(true);
      expect(mocks.findMany).toHaveBeenLastCalledWith({
        where: { playerId: "player", waivedFor: { in: [new Date("2026-11-01T00:00:00Z")] } },
        select: { waivedFor: true },
      });
    }
  });

  it("allows training notifications without a matching pause", async () => {
    expect(await isTrainingNotificationPaused("player", {
      title: "Training", body: "Reminder", data: { type: "training_cancelled", trainingDate: "2026-11-12" },
    })).toBe(false);
  });

  it("uses the Sofia current month when no training date is supplied", async () => {
    mocks.findMany.mockResolvedValue([{ waivedFor: new Date("2026-10-01T00:00:00Z") }]);
    expect(await isTrainingNotificationPaused("player", {
      title: "Training", body: "Reminder",
    }, "limited_training_promoted")).toBe(true);
  });

  it("allows a schedule covering both paused and unpaused months", async () => {
    mocks.findMany.mockResolvedValue([{ waivedFor: new Date("2026-10-01T00:00:00Z") }]);
    const payload = {
      title: "Schedule", body: "Updated", data: {
        type: "training_reminder", trainingDates: ["2026-10-12", "2026-11-12"],
      },
    };
    expect(await isTrainingNotificationPaused("player", payload)).toBe(false);
    mocks.findMany.mockResolvedValue([
      { waivedFor: new Date("2026-10-01T00:00:00Z") },
      { waivedFor: new Date("2026-11-01T00:00:00Z") },
    ]);
    expect(await isTrainingNotificationPaused("player", payload)).toBe(true);
  });

  it("leaves other notification types alone", async () => {
    expect(await isTrainingNotificationPaused("player", {
      title: "Message", body: "Hello", data: { type: "trainer_message" },
    })).toBe(false);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
