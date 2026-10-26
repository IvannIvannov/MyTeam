import FacebookConnection from "./FacebookConnection";
import "../page.css";

export default async function FacebookConnectionPage({ searchParams }: { searchParams: Promise<{ clubId?: string; facebook?: string }> }) {
  const { clubId, facebook } = await searchParams;
  return <FacebookConnection clubId={clubId || ""} failed={facebook === "failed"} />;
}
