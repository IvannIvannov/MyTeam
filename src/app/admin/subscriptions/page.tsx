import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminToken } from "@/lib/adminAuth";
import SubscriptionsPageClient from "./page.client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Абонаменти | MyTeam" };

export default async function SubscriptionsPage() {
  const token = (await cookies()).get("admin_session")?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) redirect("/admin/login?next=/admin/subscriptions");
  if (!session.roles.includes("admin")) redirect("/admin/coach-home");
  return <SubscriptionsPageClient />;
}
