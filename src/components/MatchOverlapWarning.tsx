"use client";

import { useEffect, useState } from "react";
import { isIsoDate, isValidTrainingTime } from "@/lib/training";
import "./matchOverlapWarning.css";

export default function MatchOverlapWarning({ clubId, date, time, duration, isHome, excludeMatchId }: {
  clubId: string; date: string; time: string; duration: string; isHome: boolean | null; excludeMatchId?: string;
}) {
  const valid = isHome === true && isIsoDate(date) && isValidTrainingTime(time) && Number.isInteger(Number(duration)) && Number(duration) >= 1 && Number(duration) <= 1440;
  const key = JSON.stringify([clubId, date, time, duration, isHome, excludeMatchId]);
  const [result, setResult] = useState<{ key: string; warnings: string[]; error?: boolean } | null>(null);
  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({ date, time, duration, isHome: "true" });
        if (excludeMatchId) query.set("excludeMatchId", excludeMatchId);
        const response = await fetch(`/api/admin/clubs/${clubId}/matches/overlaps?${query}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Overlap check failed");
        const data = await response.json() as { warnings: string[] };
        if (!cancelled) setResult({ key, warnings: data.warnings });
      } catch {
        if (!cancelled) setResult({ key, warnings: [], error: true });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [clubId, date, time, duration, excludeMatchId, key, valid]);
  if (!valid || result?.key !== key || (!result.error && result.warnings.length === 0)) return null;
  return <div className="match-overlap-warning" role="status" aria-live="polite">
    {result.error ? <p>Проверката за застъпване не е достъпна. Можете да запазите мача.</p> : <>
      <strong>Внимание: застъпване на домакински мачове</strong>
      <ul>{result.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul>
      <p>Можете да запазите мача въпреки застъпването.</p>
    </>}
  </div>;
}
