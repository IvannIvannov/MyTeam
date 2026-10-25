import { resolveFacebookPageConfig } from "@/lib/facebook/connection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminToken } from "@/lib/adminAuth";
import { isDate, UUID_PATTERN } from "@/lib/clubSubscriptionDomain";
import { birthdayGreeting, birthdayPhotoUrl, FacebookPublishError, publishBirthdayPhoto } from "@/lib/facebook/birthday";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; playerId: string }> };

async function authorize(request: NextRequest, context: Context) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: clubId, playerId } = await context.params;
  if (!UUID_PATTERN.test(clubId) || !UUID_PATTERN.test(playerId)) return NextResponse.json({ error: "Invalid player or club" }, { status: 400 });
  // Existing coach sessions are club-wide unless a default club is set.
  if (!session.roles.includes("admin") && session.defaultClubId && session.defaultClubId !== clubId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const coachGroupId = request.nextUrl.searchParams.get("coachGroupId") || null;
  if (coachGroupId && !UUID_PATTERN.test(coachGroupId)) return NextResponse.json({ error: "Invalid group" }, { status: 400 });
  const player = await prisma.player.findFirst({
    where: { id: playerId, clubId, isActive: true, ...(coachGroupId ? { coachGroups: { some: { id: coachGroupId, clubId } } } : {}) },
    select: { id: true, fullName: true, birthDate: true, club: { select: { name: true } }, images: { select: { imageUrl: true, isAdminView: true } } },
  });
  if (!player) return NextResponse.json({ error: "Състезателят не е намерен в клуба или групата." }, { status: 404 });
  return { clubId, playerId, player, session };
}

function validBirthday(date: unknown, birthDate: Date | null): date is string {
  return isDate(date) && !!birthDate && date.slice(5) === birthDate.toISOString().slice(5, 10);
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const auth = await authorize(request, context);
    if (auth instanceof NextResponse) return auth;
    const date = request.nextUrl.searchParams.get("birthdayDate");
    if (!validBirthday(date, auth.player.birthDate)) return NextResponse.json({ error: "Невалидна дата на рождения ден." }, { status: 400 });
    const config = await resolveFacebookPageConfig(auth.clubId);
    const post = await prisma.facebookBirthdayPost.findUnique({ where: { clubId_playerId_birthdayYear: { clubId: auth.clubId, playerId: auth.playerId, birthdayYear: Number(date.slice(0, 4)) } }, select: { status: true, facebookPostId: true } });
    return NextResponse.json({
      connected: !!config, pageName: config?.pageName ?? null, pageId: config?.pageId ?? null,
      photoUrl: birthdayPhotoUrl(auth.player.images),
      message: birthdayGreeting(auth.player.fullName, auth.player.club.name),
      status: post?.status ?? null, facebookPostId: post?.facebookPostId ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Поздравлението не може да бъде заредено. Свържете се с администратора." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: Context) {
  // Cookie-authenticated public publishing must originate from this app.
  if (request.headers.get("origin") !== request.nextUrl.origin || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const auth = await authorize(request, context);
    if (auth instanceof NextResponse) return auth;
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 5000 || !validBirthday(body.birthdayDate, auth.player.birthDate)) return NextResponse.json({ error: "Въведете поздравление до 5000 знака и валидна дата." }, { status: 400 });
    const config = await resolveFacebookPageConfig(auth.clubId);
    if (!config) return NextResponse.json({ error: "Facebook страницата на клуба още не е свързана." }, { status: 409 });
    const photoUrl = birthdayPhotoUrl(auth.player.images);
    if (!photoUrl) return NextResponse.json({ error: "Добавете снимка на състезателя преди публикуване." }, { status: 400 });
    if (body.photoUrl !== photoUrl || body.pageId !== config.pageId) return NextResponse.json({ error: "Снимката или Facebook страницата е променена. Отворете поздрава отново." }, { status: 409 });
    const key = { clubId: auth.clubId, playerId: auth.playerId, birthdayYear: Number(body.birthdayDate.slice(0, 4)) };
    const data = { ...key, message, photoUrl, pageId: config.pageId, createdBy: auth.session.sub, status: "publishing" };
    const previous = await prisma.facebookBirthdayPost.findUnique({ where: { clubId_playerId_birthdayYear: key } });
    let postId: string;
    if (previous) {
      if (previous.status !== "failed") return NextResponse.json({ error: previous.status === "published" ? "Поздравлението вече е публикувано." : "Има заявка с непотвърден резултат. Проверете Facebook страницата с администратора.", status: previous.status, facebookPostId: previous.facebookPostId }, { status: 409 });
      const claim = await prisma.facebookBirthdayPost.updateMany({ where: { id: previous.id, status: "failed" }, data });
      if (!claim.count) return NextResponse.json({ error: "Публикуването вече е започнало.", status: "publishing" }, { status: 409 });
      postId = previous.id;
    } else {
      try { postId = (await prisma.facebookBirthdayPost.create({ data })).id; }
      catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Публикуването вече е започнало.", status: "publishing" }, { status: 409 });
        throw error;
      }
    }
    let facebookPostId: string;
    try {
      facebookPostId = await publishBirthdayPhoto(config, message, photoUrl);
    } catch (error) {
      const outcome = error instanceof FacebookPublishError ? error.outcome : "unknown";
      await prisma.facebookBirthdayPost.update({ where: { id: postId }, data: { status: outcome } });
      return NextResponse.json({ error: error instanceof FacebookPublishError ? error.message : "Проверете Facebook страницата, преди да опитате отново.", status: outcome }, { status: 502 });
    }
    // If this write fails, keep the claim in 'publishing' to prevent duplicate external posts.
    await prisma.facebookBirthdayPost.update({ where: { id: postId }, data: { status: "published", facebookPostId } });
    return NextResponse.json({ status: "published", facebookPostId });
  } catch {
    return NextResponse.json({ error: "Резултатът не може да бъде потвърден. Проверете Facebook страницата с администратора.", status: "unknown" }, { status: 500 });
  }
}
