import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { birthdayGreeting, birthdayPhotoUrl, getFacebookPageConfig, publishBirthdayPhoto } from "./birthday";
const config = { pageId: "123", pageName: "Клуб", accessToken: "secret-page-token", apiVersion: "v26.0" };
beforeEach(() => { vi.stubEnv("FACEBOOK_PAGES", JSON.stringify({ club: config })); vi.stubEnv("FACEBOOK_GRAPH_API_VERSION", "v26.0"); vi.stubEnv("CLOUDINARY_CLOUD_NAME", "test-cloud"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("keeps configuration scoped to each club and rejects malformed credentials", () => {
  expect(getFacebookPageConfig("club")).toEqual(config);
  expect(getFacebookPageConfig("other")).toBeNull();
  vi.stubEnv("FACEBOOK_PAGES", '{"club":{"pageId":"../../me"}}');
  expect(() => getFacebookPageConfig("club")).toThrow("Invalid Facebook Page configuration");
});
it("builds a photo URL from the primary stored image and creates a greeting with no profile link", () => {
  expect(birthdayPhotoUrl([{ imageUrl: "other.jpg", isAdminView: false }, { imageUrl: "player.jpg", isAdminView: true }])).toBe("https://res.cloudinary.com/test-cloud/image/upload/w_1200,c_limit,f_jpg,q_auto:good/player.jpg");
  expect(birthdayPhotoUrl([])).toBeNull();
  expect(birthdayPhotoUrl([{ imageUrl: "http://private.test/photo", isAdminView: true }])).toBeNull();
  expect(birthdayGreeting("Иван", "Клуб")).toContain("Иван");
  expect(birthdayGreeting("Иван", "Клуб")).not.toContain("/member/");
});
it("sends the photo and edited caption as the Page, without any player link", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "456", post_id: "123_456" })));
  vi.stubGlobal("fetch", fetchMock);
  expect(await publishBirthdayPhoto(config, "Редактиран поздрав", "https://example.com/photo.jpg")).toBe("123_456");
  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toBe("https://graph.facebook.com/v26.0/123/photos");
  expect(request.headers.Authorization).toBe("Bearer secret-page-token");
  expect(Object.fromEntries(request.body)).toEqual({ url: "https://example.com/photo.jpg", caption: "Редактиран поздрав", published: "true" });
  expect(url).not.toContain("secret-page-token");
});
it("maps expired tokens to a retryable failure without leaking provider secrets", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 190, message: "secret-page-token" } }), { status: 400 })));
  await expect(publishBirthdayPhoto(config, "hello", "https://example.com/photo.jpg")).rejects.toMatchObject({ outcome: "failed", message: expect.not.stringContaining("secret-page-token") });
});
it("never retries ambiguous network or server failures", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error("secret-page-token"));
  vi.stubGlobal("fetch", fetchMock);
  await expect(publishBirthdayPhoto(config, "hello", "https://example.com/photo.jpg")).rejects.toMatchObject({ outcome: "unknown" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 2 } }), { status: 500 }));
  await expect(publishBirthdayPhoto(config, "hello", "https://example.com/photo.jpg")).rejects.toMatchObject({ outcome: "unknown" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
