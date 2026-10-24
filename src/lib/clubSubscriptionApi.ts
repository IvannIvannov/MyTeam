import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";
import { SubscriptionError } from "@/lib/clubSubscriptionDomain";

export async function subscriptionAdmin(request: NextRequest) {
  const token = request.cookies.get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session.roles.includes("admin")) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { session };
}

export function subscriptionApiError(error: unknown) {
  if (error instanceof SubscriptionError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) {
    return NextResponse.json({ error: "Данните са променени. Обновете страницата и опитайте отново." }, { status: 409 });
  }
  console.error("Club subscription error:", error);
  return NextResponse.json({ error: "Грешка при обработка на абонамента." }, { status: 500 });
}
