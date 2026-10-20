import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), club: vi.fn(), players: vi.fn(), create: vi.fn(), warnings: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { club: { findUnique: mocks.club }, player: { findMany: mocks.players }, clubMatch: { create: mocks.create } } }));
vi.mock("@/lib/matchConflicts", () => ({ getMatchOverlapWarnings: mocks.warnings }));
vi.mock("@/lib/push/matchScheduleNotifications", () => ({ sendMatchScheduleNotifications: vi.fn() }));
describe("creating overlapping games", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.auth.mockResolvedValue({ roles: ["coach"] }); mocks.club.mockResolvedValue({ id: "club" }); mocks.players.mockResolvedValue([]);
    mocks.create.mockImplementation(({ data }) => Promise.resolve({ id: "new", ...data }));
    mocks.warnings.mockResolvedValue(["Застъпване с домакински мач"]);
  });
  it("creates the game and returns the advisory warning", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/clubs/club/matches", { method: "POST", headers: { cookie: "admin_session=test", "Content-Type": "application/json" }, body: JSON.stringify({ category: "friendly", description: " Match notes ", eventType: "competition", matchDate: "2026-10-19", matchTime: "15:00", durationMinutes: 90, isHome: true, opponent: "Съперник", location: "Стадион" }) }), { params: Promise.resolve({ id: "club" }) });
    expect(response.status).toBe(201);
    expect((await response.json()).warning).toBe("Застъпване с домакински мач");
    expect(mocks.create).toHaveBeenCalled();
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ category: "friendly", description: "Match notes" });
    expect(mocks.create.mock.calls[0][0].data.eventType).toBe("competition");
  });
  it("rejects unsupported event types", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/clubs/club/matches", { method: "POST", headers: { cookie: "admin_session=test", "Content-Type": "application/json" }, body: JSON.stringify({ category: "friendly", description: " Match notes ", eventType: "other" }) }), { params: Promise.resolve({ id: "club" }) });
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("game classification validation", () => {
  it.each([undefined, null, "", "other"])("rejects missing or invalid category %s", async (category) => {
    mocks.auth.mockResolvedValue({ roles: ["coach"] }); mocks.club.mockResolvedValue({ id: "club" }); mocks.create.mockClear();
    const response = await POST(new NextRequest("http://localhost/api/admin/clubs/club/matches", { method: "POST", headers: { cookie: "admin_session=test", "Content-Type": "application/json" }, body: JSON.stringify({ category }) }), { params: Promise.resolve({ id: "club" }) });
    expect(response.status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["x".repeat(2001), { text: "invalid" }])("rejects invalid descriptions", async (description) => {
    mocks.auth.mockResolvedValue({ roles: ["coach"] }); mocks.club.mockResolvedValue({ id: "club" }); mocks.create.mockClear();
    const response = await POST(new NextRequest("http://localhost/api/admin/clubs/club/matches", { method: "POST", headers: { cookie: "admin_session=test", "Content-Type": "application/json" }, body: JSON.stringify({ category: "official", description }) }), { params: Promise.resolve({ id: "club" }) });
    expect(response.status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
  });
});
