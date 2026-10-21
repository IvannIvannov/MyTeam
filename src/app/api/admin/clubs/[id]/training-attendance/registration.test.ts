import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), sessions: vi.fn(), players: vi.fn(), enroll: vi.fn(), refreshed: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.auth }));
vi.mock("@/lib/memberEvents", () => ({ publishMemberUpdated: vi.fn() }));
vi.mock("@/lib/trainingAttendanceEvents", () => ({ publishTrainingAttendanceUpdated: vi.fn() }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: vi.fn() }));
vi.mock("@/lib/db", () => {
  const db = {
  $queryRaw: vi.fn(),
  club: { findUnique: vi.fn().mockResolvedValue({ paymentWorkflow: "calendar" }) },
  trainingSession: { findMany: mocks.sessions, findFirst: mocks.refreshed }, player: { findMany: mocks.players },
  trainingSessionPlayer: { createMany: mocks.enroll },
  };
  return { prisma: { ...db, $transaction: async (callback: (tx: typeof db) => unknown) => callback(db) } };
});

const coachId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ roles: ["admin"] });
  mocks.players.mockResolvedValue([{ id: "new-player", fullName: "New player", teamGroup: 2012, createdAt: new Date("2026-10-20T12:00:00Z"), cards: [] }]);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

it("includes a newly registered coach-group member in an existing future session", async () => {
  mocks.sessions.mockResolvedValue([{
    id: "future-session", scopeId: coachId, scopeKey: `coach_group:${coachId}`, trainingDate: new Date("2026-10-21T00:00:00Z"),
    trainingTime: "17:00", trainingDurationMinutes: 60, trainingFieldId: null,
    trainingFieldPieceIds: [], status: "scheduled", note: null,
    players: [{ playerId: "existing-player", playerName: "Existing player", teamGroup: 2012, present: true, player: { cards: [] } }],
  }]);
  const existing = (await mocks.sessions())[0];
  mocks.refreshed.mockResolvedValueOnce(existing).mockResolvedValue({ ...existing, players: [
    { playerId: "existing-player", playerName: "Existing player", teamGroup: 2012, present: true, player: { cards: [] } },
    { playerId: "new-player", playerName: "New player", teamGroup: 2012, present: true, player: { cards: [] } },
  ] });
  const response = await GET(new NextRequest(
    `http://localhost/api/admin/clubs/club-1/training-attendance?coachGroupId=${coachId}&month=2026-10&date=2026-10-21`,
    { headers: { cookie: "admin_session=test" } },
  ), { params: Promise.resolve({ id: "club-1" }) });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.players.map((p: { id: string }) => p.id)).toContain("new-player");
  expect(mocks.enroll).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ trainingSessionId: "future-session", playerId: "new-player" })] }));
});
