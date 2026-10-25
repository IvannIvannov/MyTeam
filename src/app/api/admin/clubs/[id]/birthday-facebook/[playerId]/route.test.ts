import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { FacebookPublishError } from "@/lib/facebook/birthday";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), player: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(), claim: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/facebook/connection", async () => { const { getFacebookPageConfig } = await import("@/lib/facebook/birthday"); return { resolveFacebookPageConfig: async (id: string) => getFacebookPageConfig(id) }; });
vi.mock("@/lib/adminAuth", () => ({ verifyAdminToken: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { player: { findFirst: mocks.player }, facebookBirthdayPost: { findUnique: mocks.find, create: mocks.create, update: mocks.update, updateMany: mocks.claim } } }));
vi.mock("@/lib/facebook/birthday", async (original) => ({ ...await original<typeof import("@/lib/facebook/birthday")>(), publishBirthdayPhoto: mocks.publish }));
const clubId = "10000000-0000-4000-8000-000000000001";
const playerId = "10000000-0000-4000-8000-000000000002";
const groupId = "10000000-0000-4000-8000-000000000003";
const context = { params: Promise.resolve({ id: clubId, playerId }) };
const photoUrl = "https://example.com/player.jpg";
const payload = { birthdayDate: "2026-10-28", message: "Редактиран поздрав", photoUrl, pageId: "123" };
function request(method = "GET", body: unknown = payload, options: { cookie?: boolean; origin?: string; query?: string } = {}) {
  return new NextRequest(`http://localhost/api/admin/clubs/${clubId}/birthday-facebook/${playerId}?birthdayDate=2026-10-28${options.query || ""}`, {
    method, headers: { ...(options.cookie === false ? {} : { cookie: "admin_session=test" }), ...(method === "POST" ? { origin: options.origin ?? "http://localhost", "Content-Type": "application/json" } : {}) },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FACEBOOK_PAGES", JSON.stringify({ [clubId]: { pageId: "123", pageName: "Club Page", accessToken: "SECRET" } }));
  mocks.auth.mockResolvedValue({ sub: "coach", roles: ["coach"], defaultClubId: null });
  mocks.player.mockResolvedValue({ id: playerId, fullName: "Иван", birthDate: new Date("2010-10-28"), club: { name: "Клуб" }, images: [{ imageUrl: photoUrl, isAdminView: true }] });
  mocks.find.mockResolvedValue(null); mocks.create.mockResolvedValue({ id: "claim" }); mocks.update.mockResolvedValue({}); mocks.claim.mockResolvedValue({ count: 1 }); mocks.publish.mockResolvedValue("123_456");
});
afterEach(() => vi.unstubAllEnvs());
it("requires authentication and protects cookie-authenticated publication from cross-site requests", async () => {
  expect((await GET(request("GET", null, { cookie: false }), context)).status).toBe(401);
  expect((await POST(request("POST", payload, { origin: "https://other.example" }), context)).status).toBe(403);
  expect(mocks.player).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
});
it("enforces the club and optional group when selecting a player", async () => {
  await GET(request("GET", null, { query: `&coachGroupId=${groupId}` }), context);
  expect(mocks.player.mock.calls[0][0].where).toEqual({ id: playerId, clubId, isActive: true, coachGroups: { some: { id: groupId, clubId } } });
  mocks.player.mockResolvedValue(null);
  expect((await POST(request("POST"), context)).status).toBe(404);
  expect(mocks.publish).not.toHaveBeenCalled();
});
it("previews the exact photo and Page without exposing credentials or player-profile links", async () => {
  const response = await GET(request(), context);
  const body = await response.json();
  expect(body).toMatchObject({ connected: true, pageName: "Club Page", photoUrl, status: null });
  expect(JSON.stringify(body)).not.toMatch(/SECRET|accessToken|\/member\//);
});
it("publishes the reviewed caption and server-selected photo after persisting a claim", async () => {
  mocks.publish.mockImplementation(async () => { expect(mocks.create).toHaveBeenCalled(); return "123_456"; });
  const response = await POST(request("POST"), context);
  expect(await response.json()).toEqual({ status: "published", facebookPostId: "123_456" });
  expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ pageId: "123", accessToken: "SECRET" }), payload.message, photoUrl);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "claim" }, data: { status: "published", facebookPostId: "123_456" } });
});
it("rejects missing configuration, photos, tampered previews, dates and empty captions", async () => {
  for (const body of [{ ...payload, message: " " }, { ...payload, birthdayDate: "2026-10-29" }, { ...payload, photoUrl: "https://evil.example/photo" }, { ...payload, pageId: "999" }]) {
    expect((await POST(request("POST", body), context)).status).toBeGreaterThanOrEqual(400);
  }
  vi.stubEnv("FACEBOOK_PAGES", "{}"); expect((await POST(request("POST"), context)).status).toBe(409);
  vi.stubEnv("FACEBOOK_PAGES", JSON.stringify({ [clubId]: { pageId: "123", pageName: "Club", accessToken: "SECRET" } }));
  mocks.player.mockResolvedValue({ id: playerId, fullName: "Иван", birthDate: new Date("2010-10-28"), club: { name: "Клуб" }, images: [] });
  expect((await POST(request("POST"), context)).status).toBe(400);
  expect(mocks.publish).not.toHaveBeenCalled();
});
it("blocks duplicate, in-flight and ambiguous requests, including concurrent insertion", async () => {
  for (const status of ["published", "publishing", "unknown"]) {
    mocks.find.mockResolvedValue({ id: "claim", status });
    expect((await POST(request("POST"), context)).status).toBe(409);
  }
  mocks.find.mockResolvedValue(null); mocks.create.mockRejectedValue({ code: "P2002" });
  expect((await POST(request("POST"), context)).status).toBe(409);
  expect(mocks.publish).not.toHaveBeenCalled();
});
it("allows retries only after a confirmed failure and atomically claims them", async () => {
  mocks.find.mockResolvedValue({ id: "old", status: "failed" });
  expect((await POST(request("POST"), context)).status).toBe(200);
  expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "old", status: "failed" } }));
  mocks.publish.mockClear(); mocks.claim.mockResolvedValue({ count: 0 });
  expect((await POST(request("POST"), context)).status).toBe(409); expect(mocks.publish).not.toHaveBeenCalled();
});
it("records ambiguous provider outcomes without leaking details", async () => {
  mocks.publish.mockRejectedValue(new FacebookPublishError("unknown", "Проверете страницата."));
  const response = await POST(request("POST"), context);
  expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: "Проверете страницата.", status: "unknown" });
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "claim" }, data: { status: "unknown" } });
});
it("keeps the publishing claim when the result cannot be saved, preventing a second post", async () => {
  mocks.update.mockRejectedValue(new Error("database lost"));
  expect((await POST(request("POST"), context)).status).toBe(500);
  expect(mocks.publish).toHaveBeenCalledTimes(1);
  expect(mocks.update).toHaveBeenCalledTimes(1);
});

it("honors an explicitly restricted coach club", async () => {
  mocks.auth.mockResolvedValue({ sub: "coach", roles: ["coach"], defaultClubId: "10000000-0000-4000-8000-000000000099" });
  expect((await GET(request(), context)).status).toBe(403);
  expect(mocks.player).not.toHaveBeenCalled();
});
it("marks a confirmed Facebook rejection as failed for a later manual retry", async () => {
  mocks.publish.mockRejectedValue(new FacebookPublishError("failed", "Няма разрешение."));
  expect((await POST(request("POST"), context)).status).toBe(502);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "claim" }, data: { status: "failed" } });
});
