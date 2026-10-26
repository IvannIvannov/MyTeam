import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { sessionHash, unseal } from "@/lib/facebook/connection";
const m = vi.hoisted(() => ({ auth: vi.fn(), club: vi.fn(), find: vi.fn(), claim: vi.fn(), exchange: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: m.auth }));
vi.mock("@/lib/db", () => ({ prisma: { club: { findUnique: m.club }, facebookConnectAttempt: { findFirst: m.find, updateMany: m.claim } } }));
vi.mock("@/lib/facebook/connection", async original => ({ ...await original<typeof import("@/lib/facebook/connection")>(), exchangeFacebookCode: m.exchange }));
const state = "ab".repeat(32);
const club = "10000000-0000-4000-8000-000000000001";
function request(query = `state=${state}&code=CODE`, cookie = state) {
  return new NextRequest(`https://myteam.example/api/facebook/callback?${query}`, { headers: { cookie: `admin_session=SESSION; facebook_connect=${cookie}` } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FACEBOOK_APP_ID", "123"); vi.stubEnv("FACEBOOK_APP_SECRET", "APP_SECRET"); vi.stubEnv("FACEBOOK_APP_URL", "https://myteam.example"); vi.stubEnv("FACEBOOK_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
  m.auth.mockResolvedValue({ sub: "coach", roles: ["coach"], defaultClubId: club }); m.club.mockResolvedValue({ id: club });
  m.find.mockResolvedValue({ id: state, clubId: club, sessionHash: sessionHash("SESSION") });
  m.claim.mockResolvedValue({ count: 1 }); m.exchange.mockResolvedValue([{ id: "123", name: "Club", access_token: "PAGE_SECRET" }]);
});
afterEach(() => vi.unstubAllEnvs());
it("rejects missing/mismatched state before contacting Facebook", async () => {
  for (const req of [request("code=CODE"), request(undefined, "OTHER")]) {
    const response = await GET(req); expect(response.headers.get("location")).toContain("facebook=failed");
  }
  expect(m.find).not.toHaveBeenCalled(); expect(m.exchange).not.toHaveBeenCalled();
});
it("rejects expired attempts, changed sessions and cross-club coaches", async () => {
  m.find.mockResolvedValueOnce(null); await GET(request());
  m.find.mockResolvedValueOnce({ id: state, clubId: club, sessionHash: "other" }); await GET(request());
  m.auth.mockResolvedValue({ sub: "coach", roles: ["coach"], defaultClubId: "other" }); await GET(request());
  expect(m.exchange).not.toHaveBeenCalled();
});
it("claims the state before exchange, stores encrypted choices, redirects without code or credentials", async () => {
  m.exchange.mockImplementation(async () => { expect(m.claim.mock.calls[0][0].data).toEqual({ status: "exchanging" }); return [{ id: "123", name: "Club", access_token: "PAGE_SECRET" }]; });
  const response = await GET(request());
  expect(response.headers.get("location")).toBe(`https://myteam.example/admin/members/facebook?clubId=${club}`);
  const saved = m.claim.mock.calls[1][0];
  expect(saved.where).toMatchObject({ id: state, status: "exchanging" });
  expect(saved.data.status).toBe("choosing");
  expect(unseal(saved.data.encryptedPages, `attempt:${state}`)).toContain("PAGE_SECRET");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});
it("blocks replay and cancelled authorization", async () => {
  m.claim.mockResolvedValueOnce({ count: 0 }); await GET(request());
  await GET(request(`state=${state}&error=access_denied`));
  expect(m.exchange).not.toHaveBeenCalled();
});
it("clears temporary credentials after provider failure without leaking its error", async () => {
  m.exchange.mockRejectedValue(new Error("TOKEN_SECRET"));
  const response = await GET(request());
  expect(response.headers.get("location")).toContain("facebook=failed");
  expect(response.headers.get("location")).not.toContain("SECRET");
  expect(m.claim).toHaveBeenLastCalledWith({ where: { id: state, status: "exchanging" }, data: { status: "failed", encryptedPages: null } });
  expect(response.headers.get("set-cookie")).toContain("facebook_connect=");
});
