import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeFacebookClub } from "@/lib/facebook/authorization";
import { CONNECTION_PATH, FACEBOOK_COOKIE, exchangeFacebookCode, facebookSettings, seal, sessionHash } from "@/lib/facebook/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  let clubId = "";
  let attemptId: string | undefined;
  try {
    const settings = facebookSettings();
    const state = request.nextUrl.searchParams.get("state");
    const cookie = request.cookies.get(FACEBOOK_COOKIE)?.value;
    if (!state || !/^[a-f0-9]{64}$/.test(state) || state !== cookie) throw new Error("Invalid state");
    const attempt = await prisma.facebookConnectAttempt.findFirst({ where: { id: state, status: "pending", expiresAt: { gt: new Date() } } });
    if (!attempt) throw new Error("Expired state");
    const auth = await authorizeFacebookClub(request, attempt.clubId);
    if (auth instanceof NextResponse || sessionHash(auth.token) !== attempt.sessionHash) throw new Error("Invalid session");
    clubId = attempt.clubId;
    attemptId = state;
    const claim = await prisma.facebookConnectAttempt.updateMany({ where: { id: state, status: "pending", expiresAt: { gt: new Date() } }, data: { status: "exchanging" } });
    if (!claim.count) throw new Error("Used state");
    const code = request.nextUrl.searchParams.get("code");
    if (!code || code.length > 4096 || request.nextUrl.searchParams.has("error")) throw new Error("Authorization cancelled");
    const pages = await exchangeFacebookCode(code);
    const saved = await prisma.facebookConnectAttempt.updateMany({ where: { id: state, status: "exchanging", expiresAt: { gt: new Date() } }, data: { status: "choosing", encryptedPages: seal(JSON.stringify(pages), `attempt:${state}`) } });
    if (!saved.count) throw new Error("Expired connection");
    const url = new URL(CONNECTION_PATH, settings.origin);
    url.searchParams.set("clubId", clubId);
    return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    if (attemptId) {
      try { await prisma.facebookConnectAttempt.updateMany({ where: { id: attemptId, status: "exchanging" }, data: { status: "failed", encryptedPages: null } }); } catch { /* Do not log provider secrets. */ }
    }
    let origin: string;
    try { origin = facebookSettings().origin; } catch { return NextResponse.json({ error: "Facebook setup is incomplete" }, { status: 503 }); }
    const url = new URL(CONNECTION_PATH, origin);
    if (clubId) url.searchParams.set("clubId", clubId);
    url.searchParams.set("facebook", "failed");
    const response = NextResponse.redirect(url, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    response.cookies.delete(FACEBOOK_COOKIE);
    return response;
  }
}
