import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/clubs/[id]/training-attendance/route";

const mocks = vi.hoisted(() => ({ player: vi.fn(), sessions: vi.fn(), club: vi.fn(), group: vi.fn() }));
const groupId = "10000000-0000-4000-8000-000000000002";
const date = "2026-10-21";
const scopeKey = `custom_group:${groupId}`;
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: vi.fn().mockResolvedValue({ roles: ["admin"] }) }));
vi.mock("@/lib/memberEvents", () => ({ publishMemberUpdated: vi.fn() }));
vi.mock("@/lib/trainingAttendanceEvents", () => ({ publishTrainingAttendanceUpdated: vi.fn() }));
vi.mock("@/lib/push/service", () => ({ sendPushToMember: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  club: { findUnique: mocks.club },
  clubCustomTrainingGroup: { findFirst: mocks.group },
  player: { findMany: mocks.player },
  trainingSession: { findMany: mocks.sessions, findFirst: async () => ({ status: "scheduled" }) },
  trainingOptOut: { findMany: async () => [] }, trainingNote: { findFirst: async () => null },
} }));
afterEach(() => vi.useRealTimers());

it.each([
  ["calendar_month", true], ["calendar_month", false],
  ["rolling_30_days", false], ["training_credits", true], ["training_credits", false],
  ["training_credits_30_days", false],
] as const)("keeps locked departed members and their attendance for %s, present=%s", async (paymentWorkflow, present) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T09:00Z"));
  mocks.club.mockResolvedValue({ id: "club", name: "Club", paymentWorkflow, trainingGroupMode: "custom_group" });
  mocks.group.mockResolvedValue({ id: groupId, trainingDates: [date, "2026-10-22"], trainingWeekdays: [], trainingDateTimes: { [date]: "18:00", "2026-10-22": "18:00" }, trainingTime: "18:00", trainingWindowDays: 30, trainingDurationMinutes: 60, trainingFieldId: null, trainingFieldPieceIds: [], players: [{ playerId: "new" }] });
  const departed = { id: "old", fullName: "Old", teamGroup: null, createdAt: new Date("2026-01-01"), cards: [], attendanceMemberships: [{ scopeKey, joinedAt: new Date("2026-01-01"), leftAt: new Date("2026-10-21T08:00Z") }] };
  const joined = { ...departed, id: "new", fullName: "New", attendanceMemberships: [{ scopeKey, joinedAt: new Date("2026-10-21T08:00Z"), leftAt: null }] };
  mocks.player.mockImplementation(async ({ where }) => [departed, joined].filter((player) => where.id.in.includes(player.id)));
  const session = { id: "session", trainingDate: new Date(date), trainingTime: "18:00", rosterLockedAt: new Date("2026-10-21T07:00Z"), trainingFieldId: null, trainingFieldPieceIds: [], players: [{ playerId: "old", present }] };
  mocks.sessions.mockResolvedValue([session, { ...session, id: "next", trainingDate: new Date("2026-10-22"), rosterLockedAt: null, players: [{ playerId: "new", present: true }] }]);
  for (const month of ["&month=2026-10", ""]) {
    const response = await GET(new NextRequest(`http://localhost/training?customTrainingGroupId=${groupId}${month}&date=${date}`, { headers: { cookie: "admin_session=test" } }), { params: Promise.resolve({ id: "club" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.players).toMatchObject([{ id: "old", optedOut: !present }]);
    expect(data.stats).toEqual({ total: 1, attending: present ? 1 : 0, optedOut: present ? 0 : 1 });
    expect(data.upcomingDates[1].stats.total).toBe(1);
  }
});
