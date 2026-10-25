import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { exchangeFacebookCode, facebookSettings, resolveFacebookPageConfig, seal, unseal } from "./connection";
const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { facebookPageConnection: { findUnique: mocks.find } } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FACEBOOK_APP_ID", "123"); vi.stubEnv("FACEBOOK_APP_SECRET", "APP_SECRET");
  vi.stubEnv("FACEBOOK_APP_URL", "https://myteam.example"); vi.stubEnv("FACEBOOK_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("FACEBOOK_GRAPH_API_VERSION", "v26.0"); vi.stubEnv("FACEBOOK_PAGES", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("encrypts credentials with authenticated context and rejects tampering or another club", () => {
  const encrypted = seal("PAGE_SECRET", "page:club-a");
  expect(encrypted).not.toContain("PAGE_SECRET");
  expect(unseal(encrypted, "page:club-a")).toBe("PAGE_SECRET");
  expect(() => unseal(encrypted, "page:club-b")).toThrow();
  const parts = encrypted.split("."); parts[1] = Buffer.alloc(16).toString("base64url");
  expect(() => unseal(parts.join("."), "page:club-a")).toThrow();
});
it("requires a fixed HTTPS origin and a separate valid encryption key", () => {
  expect(facebookSettings().redirectUri).toBe("https://myteam.example/api/facebook/callback");
  for (const value of ["http://localhost:3000", "https://example.com/path", "https://example.com?x=y", "https://user:pass@example.com"]) {
    vi.stubEnv("FACEBOOK_APP_URL", value); expect(() => facebookSettings()).toThrow();
  }
  vi.stubEnv("FACEBOOK_APP_URL", "https://myteam.example");
  vi.stubEnv("FACEBOOK_TOKEN_ENCRYPTION_KEY", "bad"); expect(() => facebookSettings()).toThrow();
});
it("loads the club connection and preserves an explicit disconnect over legacy configuration", async () => {
  vi.stubEnv("FACEBOOK_PAGES", JSON.stringify({ club: { pageId: "1", pageName: "Legacy", accessToken: "old" } }));
  mocks.find.mockResolvedValue(null);
  expect((await resolveFacebookPageConfig("club"))?.accessToken).toBe("old");
  mocks.find.mockResolvedValue({ encryptedToken: null, pageId: null, pageName: null });
  expect(await resolveFacebookPageConfig("club")).toBeNull();
  mocks.find.mockResolvedValue({ encryptedToken: seal("new", "page:club"), pageId: "2", pageName: "Club" });
  expect(await resolveFacebookPageConfig("club")).toMatchObject({ pageId: "2", accessToken: "new" });
});
it("exchanges codes server-side, checks permissions, paginates safely and keeps only publishable Pages", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "SHORT" })).mockResolvedValueOnce(Response.json({ access_token: "LONG" }))
    .mockResolvedValueOnce(Response.json({ data: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"].map(permission => ({ permission, status: "granted" })) }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: "1", name: "Club A", access_token: "PAGE_A", tasks: ["CREATE_CONTENT"] }, { id: "2", name: "Read only", access_token: "READ", tasks: ["ANALYZE"] }], paging: { next: "https://evil.example?access_token=LEAK", cursors: { after: "cursor" } } }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: "3", name: "Club B", access_token: "PAGE_B", tasks: ["MANAGE"] }] }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await exchangeFacebookCode("CODE")).toEqual([{ id: "1", name: "Club A", access_token: "PAGE_A" }, { id: "3", name: "Club B", access_token: "PAGE_B" }]);
  for (const [url] of fetchMock.mock.calls) expect(new URL(url).hostname).toBe("graph.facebook.com");
  expect(fetchMock.mock.calls[0][1].body.get("client_secret")).toBe("APP_SECRET");
  expect(fetchMock.mock.calls[4][1].headers).toEqual({ Authorization: "Bearer LONG" });
  expect(String(fetchMock.mock.calls[4][0])).toContain("after=cursor");
});
it("rejects partial permission grants and hides provider errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ access_token: "SHORT" })).mockResolvedValueOnce(Response.json({ access_token: "LONG" })).mockResolvedValueOnce(Response.json({ data: [{ permission: "pages_show_list", status: "granted" }] })));
  await expect(exchangeFacebookCode("CODE")).rejects.toThrow("Missing Page permissions");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "SECRET" } }, { status: 400 })));
  await expect(exchangeFacebookCode("CODE")).rejects.toThrow("Facebook authorization failed");
});
