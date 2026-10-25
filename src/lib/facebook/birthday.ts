import { applyCloudinaryTransformToUrl, buildCloudinaryUrlFromUploadPath } from "@/lib/cloudinaryImagePath";

export interface FacebookPageConfig {
  pageId: string;
  pageName: string;
  accessToken: string;
  apiVersion: string;
}

/** Server-only configuration: never serialize this object into an API response. */
export function getFacebookPageConfig(clubId: string): FacebookPageConfig | null {
  const raw = process.env.FACEBOOK_PAGES;
  if (!raw) return null;
  let pages: unknown;
  try { pages = JSON.parse(raw); } catch { throw new Error("Invalid FACEBOOK_PAGES configuration"); }
  if (!pages || typeof pages !== "object" || Array.isArray(pages)) throw new Error("Invalid FACEBOOK_PAGES configuration");
  const entry = (pages as Record<string, unknown>)[clubId];
  if (!entry) return null;
  const value = entry as Record<string, unknown>;
  const apiVersion = process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
  if (typeof value.pageId !== "string" || !/^\d+$/.test(value.pageId) ||
      typeof value.pageName !== "string" || !value.pageName.trim() ||
      typeof value.accessToken !== "string" || !value.accessToken.trim() || !/^v\d+\.\d+$/.test(apiVersion)) {
    throw new Error("Invalid Facebook Page configuration");
  }
  return { pageId: value.pageId, pageName: value.pageName.trim(), accessToken: value.accessToken.trim(), apiVersion };
}

export function birthdayPhotoUrl(images: { imageUrl: string; isAdminView: boolean }[]): string | null {
  const path = (images.find((image) => image.isAdminView) ?? images[0])?.imageUrl;
  if (!path) return null;
  const transform = "w_1200,c_limit,f_jpg,q_auto:good";
  const url = path.startsWith("https://")
    ? applyCloudinaryTransformToUrl(path, transform)
    : process.env.CLOUDINARY_CLOUD_NAME && !path.includes(":")
      ? buildCloudinaryUrlFromUploadPath(path, process.env.CLOUDINARY_CLOUD_NAME, transform)
      : null;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch { return null; }
}

export function birthdayGreeting(name: string, clubName: string): string {
  return `🎂 Честит рожден ден, ${name}!\n\nПожелаваме ти здраве, щастие и много незабравими моменти на терена! Нека всяка тренировка ти носи радост, а всеки мач — нови поводи за гордост. ⚽\n\nС най-добри пожелания от ${clubName}!`;
}

export class FacebookPublishError extends Error {
  constructor(public readonly outcome: "failed" | "unknown", message: string) { super(message); }
}

/** Exactly one external request. Network failures may have published: never retry them automatically. */
export async function publishBirthdayPhoto(config: FacebookPageConfig, message: string, photoUrl: string): Promise<string> {
  try {
    const response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.pageId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.accessToken}` },
      body: new URLSearchParams({ url: photoUrl, caption: message, published: "true" }),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
      redirect: "error",
    });
    const data = await response.json() as { id?: unknown; post_id?: unknown; error?: { code?: number } };
    if (!response.ok || data.error) {
      // 5xx responses are ambiguous; a successful write may precede the failure.
      const outcome = response.status >= 500 ? "unknown" : "failed";
      const authError = [10, 190, 200].includes(data.error?.code ?? 0);
      throw new FacebookPublishError(outcome, authError
        ? "Facebook връзката е изтекла или няма разрешение за публикуване. Свържете се с администратора."
        : outcome === "unknown" ? "Facebook не потвърди резултата. Проверете страницата, преди да опитате отново."
        : "Facebook отказа публикацията. Проверете връзката и снимката с администратора.");
    }
    const id = data.post_id ?? data.id;
    if (typeof id !== "string" || !/^\d+(?:_\d+)?$/.test(id)) throw new FacebookPublishError("unknown", "Facebook не потвърди публикацията. Проверете страницата.");
    return id;
  } catch (error) {
    if (error instanceof FacebookPublishError) throw error;
    // Never expose provider errors: they can contain access tokens and photo URLs.
    throw new FacebookPublishError("unknown", "Връзката с Facebook прекъсна. Проверете страницата, преди да опитате отново.");
  }
}
