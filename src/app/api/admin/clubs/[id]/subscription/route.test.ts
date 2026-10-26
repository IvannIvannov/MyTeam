import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), summary: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.verify }));
vi.mock("@/lib/clubSubscriptionSummary", () => ({ getClubSubscriptionSummary: mocks.summary }));
const clubA = "10000000-0000-4000-8000-000000000001";
const clubB = "10000000-0000-4000-8000-000000000002";
function get(clubId = clubA, query = "", cookie = true) {
  const request = new NextRequest(`https://myteam.example/api/admin/clubs/${clubId}/subscription${query}`, {
    headers: cookie ? { cookie: "admin_session=SESSION" } : {},
  });
  return GET(request, { params: Promise.resolve({ id: clubId }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ sub: "coach", roles: ["coach"], defaultClubId: clubA });
  mocks.summary.mockResolvedValue({ summary: { status: "active", currentFee: "10.00" } });
});
it("rejects a club-scoped coach reading another club without querying its financial data", async () => {
  const response = await get(clubB);
  expect(response.status).toBe(403);
  expect(mocks.summary).not.toHaveBeenCalled();
  expect(await response.json()).not.toHaveProperty("summary");
});
it("allows a coach to read their own club", async () => {
  const response = await get();
  expect(response.status).toBe(200);
  expect(mocks.summary).toHaveBeenCalledWith(clubA);
  expect(await response.json()).toEqual({ summary: { status: "active", currentFee: "10.00" } });
});
it("allows administrators to read a club other than their default", async () => {
  mocks.verify.mockResolvedValue({ sub: "admin", roles: ["admin"], defaultClubId: clubA });
  expect((await get(clubB)).status).toBe(200);
  expect(mocks.summary).toHaveBeenCalledWith(clubB);
});
it.each([null, undefined])("preserves access for unscoped sessions (%s)", async (defaultClubId) => {
  mocks.verify.mockResolvedValue({ sub: "coach", roles: ["coach"], defaultClubId });
  expect((await get(clubB)).status).toBe(200);
});
it("rejects missing or invalid sessions before loading data", async () => {
  expect((await get(clubA, "", false)).status).toBe(401);
  mocks.verify.mockResolvedValue(null);
  expect((await get()).status).toBe(401);
  expect(mocks.summary).not.toHaveBeenCalled();
});
it("preserves validation and group-view restrictions", async () => {
  expect((await get("invalid")).status).toBe(400);
  expect((await get(clubA, "?coachGroupId=group")).status).toBe(403);
  expect(mocks.summary).not.toHaveBeenCalled();
});
