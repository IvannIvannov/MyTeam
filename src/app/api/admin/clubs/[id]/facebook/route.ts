import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeFacebookClub } from "@/lib/facebook/authorization";
import { CONNECTION_PATH, FACEBOOK_COOKIE, facebookSettings, resolveFacebookPageConfig, seal, sessionHash, unseal, type PageChoice } from "@/lib/facebook/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function choices(request: NextRequest, clubId: string, token: string) {
  const id = request.cookies.get(FACEBOOK_COOKIE)?.value;
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const attempt = await prisma.facebookConnectAttempt.findFirst({ where: { id, clubId, sessionHash: sessionHash(token), status: "choosing", expiresAt: { gt: new Date() } } });
  if (!attempt?.encryptedPages) return null;
  return { attempt, pages: JSON.parse(unseal(attempt.encryptedPages, `attempt:${id}`)) as PageChoice[] };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const auth = await authorizeFacebookClub(request, id);
    if (auth instanceof NextResponse) return auth;
    const config = await resolveFacebookPageConfig(id);
    const pending = await choices(request, id, auth.token);
    let ready = true;
    let connectionUrl: string | null = null;
    try { connectionUrl = `${facebookSettings().origin}${CONNECTION_PATH}?clubId=${encodeURIComponent(id)}`; } catch { ready = false; }
    return json({ ready, connectionUrl, page: config ? { id: config.pageId, name: config.pageName } : null, choices: pending?.pages.map(p => ({ id: p.id, name: p.name })) ?? [], choosing: !!pending });
  } catch { return json({ error: "Facebook връзката не може да бъде заредена." }, 500); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const settings = facebookSettings();
    const { id: clubId } = await context.params;
    if (request.headers.get("origin") !== settings.origin) return json({
      error: "Отворете Facebook настройките през публичния адрес на MyTeam. Влезте в профила си там и опитайте отново.",
      code: "FACEBOOK_ORIGIN_MISMATCH",
      connectionUrl: `${settings.origin}${CONNECTION_PATH}?clubId=${encodeURIComponent(clubId)}`,
    }, 403);
    if (request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Заявката трябва да бъде изпратена от страницата на MyTeam.", code: "FACEBOOK_CROSS_SITE" }, 403);
    const auth = await authorizeFacebookClub(request, clubId);
    if (auth instanceof NextResponse) return auth;
    let body: { action?: string; pageId?: string };
    try { body = await request.json(); if (!body || typeof body !== "object") throw new Error(); } catch { return json({ error: "Invalid request" }, 400); }
    if (body.action === "start") {
      // Expired candidates contain tokens: remove them on subsequent connection starts.
      await prisma.facebookConnectAttempt.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { clubId, sessionHash: sessionHash(auth.token) }] } });
      const state = randomBytes(32).toString("hex");
      await prisma.facebookConnectAttempt.create({ data: { id: state, clubId, sessionHash: sessionHash(auth.token), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
      const url = new URL(`https://www.facebook.com/${settings.version}/dialog/oauth`);
      url.search = new URLSearchParams({ client_id: settings.appId, redirect_uri: settings.redirectUri, state, response_type: "code", scope: "pages_show_list,pages_read_engagement,pages_manage_posts", auth_type: "rerequest" }).toString();
      const response = json({ url: url.toString() });
      response.cookies.set(FACEBOOK_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
      return response;
    }
    if (body.action === "select") {
      const pending = await choices(request, clubId, auth.token);
      const page = pending?.pages.find(p => p.id === body.pageId);
      if (!pending || !page) return json({ error: "Изборът е изтекъл. Свържете се отново." }, 409);
      await prisma.$transaction(async tx => {
        const claim = await tx.facebookConnectAttempt.updateMany({ where: { id: pending.attempt.id, status: "choosing", expiresAt: { gt: new Date() } }, data: { status: "used", encryptedPages: null } });
        if (!claim.count) throw new Error("Connection already consumed");
        const data = { pageId: page.id, pageName: page.name, encryptedToken: seal(page.access_token, `page:${clubId}`), connectedBy: auth.session.sub };
        await tx.facebookPageConnection.upsert({ where: { clubId }, create: { clubId, ...data }, update: data });
      });
      const response = json({ connected: true });
      response.cookies.delete(FACEBOOK_COOKIE);
      return response;
    }
    if (body.action === "disconnect") {
      // Keep a disconnected row so legacy environment settings cannot silently reconnect it.
      const data = { pageId: null, pageName: null, encryptedToken: null, connectedBy: auth.session.sub };
      await prisma.$transaction([
        prisma.facebookPageConnection.upsert({ where: { clubId }, create: { clubId, ...data }, update: data }),
        prisma.facebookConnectAttempt.deleteMany({ where: { clubId } }),
      ]);
      const response = json({ connected: false });
      response.cookies.delete(FACEBOOK_COOKIE);
      return response;
    }
    return json({ error: "Invalid action" }, 400);
  } catch { return json({ error: "Facebook връзката не бе променена. Проверете настройките и опитайте отново." }, 500); }
}
