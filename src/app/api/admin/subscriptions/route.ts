import { NextRequest, NextResponse } from "next/server";
import { listClubSubscriptions } from "@/lib/clubSubscriptions";
import { subscriptionAdmin, subscriptionApiError } from "@/lib/clubSubscriptionApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await subscriptionAdmin(request);
  if (auth.error) return auth.error;
  try { return NextResponse.json(await listClubSubscriptions()); }
  catch (error) { return subscriptionApiError(error); }
}
