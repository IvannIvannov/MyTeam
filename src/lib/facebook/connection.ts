import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { getFacebookPageConfig, type FacebookPageConfig } from "./birthday";

export const FACEBOOK_COOKIE = "facebook_connect";
export const CONNECTION_PATH = "/admin/members/facebook";
export const CALLBACK_PATH = "/api/facebook/callback";
export type PageChoice = { id: string; name: string; access_token: string };

export function facebookSettings() {
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  const origin = new URL(process.env.FACEBOOK_APP_URL || "");
  const version = process.env.FACEBOOK_GRAPH_API_VERSION || "v26.0";
  if (!appId || !/^\d+$/.test(appId) || !appSecret || origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !/^v\d+\.\d+$/.test(version)) throw new Error("Facebook setup is incomplete");
  encryptionKey();
  return { appId, appSecret, origin: origin.origin, version, redirectUri: `${origin.origin}${CALLBACK_PATH}` };
}
function encryptionKey() {
  const raw = process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY || "";
  if (!/^[a-f\d]{64}$/i.test(raw)) throw new Error("Facebook encryption key is missing");
  return Buffer.from(raw, "hex");
}
export function seal(value: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64url")).join(".");
}
export function unseal(value: string, context: string): string {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted value");
  const [iv, tag, body] = parts.map(p => Buffer.from(p, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
}
export const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function resolveFacebookPageConfig(clubId: string): Promise<FacebookPageConfig | null> {
  const connection = await prisma.facebookPageConnection.findUnique({ where: { clubId } });
  if (!connection) return getFacebookPageConfig(clubId);
  if (!connection.encryptedToken || !connection.pageId || !connection.pageName) return null;
  const version = process.env.FACEBOOK_GRAPH_API_VERSION || "v26.0";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Invalid Facebook API version");
  return { pageId: connection.pageId, pageName: connection.pageName, accessToken: unseal(connection.encryptedToken, `page:${clubId}`), apiVersion: version };
}

async function graph(path: string, token?: string, parameters?: URLSearchParams): Promise<Record<string, unknown>> {
  const { version } = facebookSettings();
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  const response = await fetch(url, {
    method: parameters ? "POST" : "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: parameters,
    signal: AbortSignal.timeout(20000), cache: "no-store", redirect: "error",
  });
  const body = await response.json();
  if (!response.ok || !body || typeof body !== "object" || body.error) throw new Error("Facebook authorization failed");
  return body;
}

export async function exchangeFacebookCode(code: string): Promise<PageChoice[]> {
  const settings = facebookSettings();
  const result = await graph("oauth/access_token", undefined, new URLSearchParams({ client_id: settings.appId, client_secret: settings.appSecret, redirect_uri: settings.redirectUri, code }));
  if (typeof result.access_token !== "string") throw new Error("Missing Facebook token");
  const extended = await graph("oauth/access_token", undefined, new URLSearchParams({ grant_type: "fb_exchange_token", client_id: settings.appId, client_secret: settings.appSecret, fb_exchange_token: result.access_token }));
  if (typeof extended.access_token !== "string") throw new Error("Missing Facebook token");
  const token = extended.access_token;
  const permissions = await graph("me/permissions", token);
  const granted = new Set(Array.isArray(permissions.data) ? permissions.data.filter(p => p.status === "granted").map(p => p.permission) : []);
  if (!["pages_show_list", "pages_read_engagement", "pages_manage_posts"].every(p => granted.has(p))) throw new Error("Missing Page permissions");
  const pages: PageChoice[] = [];
  let after: string | undefined;
  // Never follow provider URLs containing tokens. Construct requests to a fixed host.
  for (let batch = 0; batch < 20; batch++) {
    const query = new URLSearchParams({ fields: "id,name,access_token,tasks", limit: "100", ...(after ? { after } : {}) });
    const result = await graph(`me/accounts?${query}`, token);
    if (!Array.isArray(result.data)) throw new Error("Invalid Facebook Pages response");
    for (const page of result.data) {
      if (typeof page.id === "string" && /^\d+$/.test(page.id) && typeof page.name === "string" && typeof page.access_token === "string" && Array.isArray(page.tasks) && page.tasks.some((t: string) => ["CREATE_CONTENT", "PROFILE_PLUS_CREATE_CONTENT", "MANAGE"].includes(t))) {
        pages.push({ id: page.id, name: page.name, access_token: page.access_token });
      }
    }
    const paging = result.paging as { next?: unknown; cursors?: { after?: unknown } } | undefined;
    if (!paging?.next) return pages;
    if (typeof paging.cursors?.after !== "string" || paging.cursors.after === after) throw new Error("Invalid Facebook pagination");
    after = paging.cursors.after;
  }
  throw new Error("Too many Facebook Pages");
}
