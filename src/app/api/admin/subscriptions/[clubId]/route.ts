import { NextRequest, NextResponse } from "next/server";
import { changeClubSubscription } from "@/lib/clubSubscriptions";
import { subscriptionAdmin, subscriptionApiError } from "@/lib/clubSubscriptionApi";
import { SubscriptionError } from "@/lib/clubSubscriptionDomain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ clubId: string }> }) {
  const auth = await subscriptionAdmin(request);
  if (auth.error) return auth.error;
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SubscriptionError("Невалидни данни.");
    const { clubId } = await params;
    return NextResponse.json(await changeClubSubscription(clubId, body as Record<string, unknown>, auth.session!.sub));
  } catch (error) { return subscriptionApiError(error); }
}
