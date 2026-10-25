import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { seal, sessionHash } from "@/lib/facebook/connection";
const m = vi.hoisted(() => ({ auth: vi.fn(), club: vi.fn(), connection: vi.fn(), find: vi.fn(), remove: vi.fn(), create: vi.fn(), claim: vi.fn(), save: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: m.auth }));
vi.mock("@/lib/db", () => ({ prisma: { club: { findUnique: m.club }, facebookPageConnection: { findUnique: m.connection, upsert: m.save }, facebookConnectAttempt: { findFirst: m.find, deleteMany: m.remove, create: m.create, updateMany: m.claim }, $transaction: m.transaction } }));
const club = "10000000-0000-4000-8000-000000000001";
const state = "ab".repeat(32);
const context = { params: Promise.resolve({ id: club }) };
function request(action?: string, pageId?: string, origin = "https://myteam.example") {
  return new NextRequest(`https://myteam.example/api/admin/clubs/${club}/facebook`, { method: action ? "POST" : "GET", headers: { cookie: `admin_session=SESSION; facebook_connect=${state}`, origin, "Content-Type": "application/json" }, ...(action ? { body: JSON.stringify({ action, pageId }) } : {}) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FACEBOOK_APP_ID", "123"); vi.stubEnv("FACEBOOK_APP_SECRET", "APP_SECRET"); vi.stubEnv("FACEBOOK_APP_URL", "https://myteam.example"); vi.stubEnv("FACEBOOK_TOKEN_ENCRYPTION_KEY", "ab".repeat(32)); vi.stubEnv("FACEBOOK_PAGES", "");
  m.auth.mockResolvedValue({ sub: "coach", roles: ["coach"], defaultClubId: club }); m.club.mockResolvedValue({ id: club }); m.connection.mockResolvedValue(null); m.find.mockResolvedValue(null); m.remove.mockResolvedValue({ count: 0 }); m.claim.mockResolvedValue({ count: 1 }); m.save.mockResolvedValue({});
  m.transaction.mockImplementation(async fn => typeof fn === "function" ? fn({ facebookConnectAttempt: { updateMany: m.claim }, facebookPageConnection: { upsert: m.save } }) : Promise.all(fn));
});
afterEach(() => vi.unstubAllEnvs());
it("requires a session, club scope and same-origin mutations", async () => {
  m.auth.mockResolvedValue(null); expect((await GET(request(), context)).status).toBe(401);
  m.auth.mockResolvedValue({ sub: "coach", roles: ["coach"], defaultClubId: "other" }); expect((await GET(request(), context)).status).toBe(403);
  expect((await POST(request("start", undefined, "https://evil.example"), context)).status).toBe(403);
  expect(m.create).not.toHaveBeenCalled();
});
it("starts a session-bound expiring flow with a secure HttpOnly cookie", async () => {
  const response = await POST(request("start"), context);
  expect(response.status).toBe(200);
  const { url } = await response.json(); const parsed = new URL(url);
  expect(parsed.origin).toBe("https://www.facebook.com");
  expect(parsed.searchParams.get("redirect_uri")).toBe("https://myteam.example/api/facebook/callback");
  expect(parsed.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/);
  expect(m.create.mock.calls[0][0].data).toMatchObject({ clubId: club, sessionHash: sessionHash("SESSION") });
  expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i); expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
  expect(url).not.toContain("APP_SECRET");
});
it("returns only Page names and IDs for the current session's choices", async () => {
  m.find.mockResolvedValue({ id: state, encryptedPages: seal(JSON.stringify([{ id: "123", name: "Club", access_token: "PAGE_SECRET" }]), `attempt:${state}`) });
  const response = await GET(request(), context); const data = await response.json();
  expect(data).toMatchObject({ choices: [{ id: "123", name: "Club" }], choosing: true });
  expect(JSON.stringify(data)).not.toMatch(/SECRET|access_token|encrypted/);
  expect(m.find.mock.calls[0][0].where).toMatchObject({ clubId: club, sessionHash: sessionHash("SESSION"), status: "choosing" });
});
it("rejects tampered Page selection and atomically consumes an offered Page before saving encrypted credentials", async () => {
  m.find.mockResolvedValue({ id: state, encryptedPages: seal(JSON.stringify([{ id: "123", name: "Club", access_token: "PAGE_SECRET" }]), `attempt:${state}`) });
  expect((await POST(request("select", "OTHER"), context)).status).toBe(409); expect(m.save).not.toHaveBeenCalled();
  expect((await POST(request("select", "123"), context)).status).toBe(200);
  expect(m.claim.mock.calls[0][0]).toMatchObject({ where: { id: state, status: "choosing" }, data: { status: "used", encryptedPages: null } });
  expect(m.save.mock.calls[0][0]).toMatchObject({ where: { clubId: club }, create: { clubId: club, pageId: "123", connectedBy: "coach" } });
  expect(m.save.mock.calls[0][0].create.encryptedToken).not.toContain("PAGE_SECRET");
  m.save.mockClear(); m.claim.mockResolvedValue({ count: 0 });
  expect((await POST(request("select", "123"), context)).status).toBe(500); expect(m.save).not.toHaveBeenCalled();
});
it("disconnects by clearing credentials and invalidating all club connection attempts", async () => {
  expect((await POST(request("disconnect"), context)).status).toBe(200);
  expect(m.save.mock.calls[0][0]).toMatchObject({ where: { clubId: club }, update: { encryptedToken: null, pageId: null, pageName: null } });
  expect(m.remove).toHaveBeenCalledWith({ where: { clubId: club } });
});
it("explains an origin mismatch and provides the configured connection URL without creating an attempt", async () => {
  const response = await POST(request("start", undefined, "http://localhost:3000"), context);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "FACEBOOK_ORIGIN_MISMATCH", connectionUrl: `https://myteam.example/admin/members/facebook?clubId=${club}` });
  expect(m.create).not.toHaveBeenCalled();
});
it("provides the canonical connection URL before a user starts authorization", async () => {
  const response = await GET(request(), context);
  expect(await response.json()).toMatchObject({ ready: true, connectionUrl: `https://myteam.example/admin/members/facebook?clubId=${club}` });
});
