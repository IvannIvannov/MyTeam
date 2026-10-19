import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), warnings: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.auth }));
vi.mock("@/lib/matchConflicts", () => ({ getMatchOverlapWarnings: mocks.warnings }));
function request(query = "date=2026-10-19&time=15:00&duration=90&isHome=true", auth = true) {
  return GET(new NextRequest(`http://localhost/api/admin/clubs/club/matches/overlaps?${query}`, { headers: auth ? { cookie: "admin_session=test" } : {} }), { params: Promise.resolve({ id: "club" }) });
}
describe("overlap preview", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ roles: ["coach"] }); mocks.warnings.mockResolvedValue(["Предупреждение"]); });
  it("requires authentication", async () => {
    expect((await request(undefined, false)).status).toBe(401);
    expect(mocks.warnings).not.toHaveBeenCalled();
  });
  it("validates scheduling input before querying", async () => {
    for (const query of ["date=no", "date=2026-10-19&time=25:00&duration=90", "date=2026-10-19&time=15:00&duration=0", "date=2026-10-19&time=15:00&duration=1.5", "date=2026-10-19&time=15:00&duration=90&excludeMatchId=bad"]) {
      expect((await request(query)).status).toBe(400);
    }
    expect(mocks.warnings).not.toHaveBeenCalled();
  });
  it("returns warnings for the requested club and excludes the edited game", async () => {
    const excludeMatchId = "12345678-1234-1234-1234-123456789012";
    const response = await request(`date=2026-10-19&time=15:00&duration=90&isHome=true&excludeMatchId=${excludeMatchId}`);
    expect(await response.json()).toEqual({ warnings: ["Предупреждение"] });
    expect(mocks.warnings).toHaveBeenCalledWith({ clubId: "club", matchDate: "2026-10-19", matchTime: "15:00", durationMinutes: 90, isHome: true, excludeMatchId });
  });
});
