"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Status = { ready: boolean; connectionUrl: string | null; page: { id: string; name: string } | null; choices: { id: string; name: string }[]; choosing: boolean };
export default function FacebookConnection({ clubId, failed }: { clubId: string; failed: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(failed ? "Свързването с Facebook не завърши. Проверете разрешенията и опитайте отново." : "");
  const [busy, setBusy] = useState(false);
  const [originMismatch, setOriginMismatch] = useState(false);
  const lock = useRef(false);
  const endpoint = `/api/admin/clubs/${encodeURIComponent(clubId)}/facebook`;
  useEffect(() => {
    const controller = new AbortController();
    if (!clubId) return;
    void (async () => {
      try {
        const response = await fetch(endpoint, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Връзката не може да бъде заредена.");
        setStatus(data);
        setOriginMismatch(!!data.connectionUrl && new URL(data.connectionUrl).origin !== window.location.origin);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Грешка при зареждане."); }
    })();
    return () => controller.abort();
  }, [clubId, endpoint]);

  async function action(action: "start" | "select" | "disconnect", pageId?: string) {
    if (lock.current) return;
    if (action === "disconnect" && !window.confirm("Да прекъснем ли Facebook връзката на клуба?")) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, pageId }) });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === "FACEBOOK_ORIGIN_MISMATCH") setOriginMismatch(true);
        throw new Error(data.error || "Свързването не бе успешно.");
      }
      if (action === "start") { window.location.assign(data.url); return; }
      const updated = await fetch(endpoint, { cache: "no-store" });
      const result = await updated.json();
      if (!updated.ok) throw new Error(result.error || "Връзката не може да бъде заредена.");
      setStatus(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Свързването не бе успешно."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <main className="amp-facebook-connect">
    <Link href={clubId ? `/admin/members?clubId=${encodeURIComponent(clubId)}` : "/admin/members"}>← Обратно към клуба</Link>
    <h1>Facebook страница на клуба</h1>
    <p>Свържете страницата на клуба, за да публикувате поздравления със снимка на състезателя. Всеки поздрав се преглежда и публикува от треньор.</p>
    {error && <p role="alert" className="amp-confirm-error">{error}</p>}
    {!clubId ? <p>Отворете настройките от страницата на клуба.</p> : !status ? (!error && <p role="status">Зареждане…</p>) : <>
      {originMismatch && status.connectionUrl && <p role="status">За свързване използвайте публичния адрес на MyTeam. <a href={status.connectionUrl}>Отвори Facebook настройките на публичния адрес</a>. Влезте в профила си там.</p>}
      {status.page ? <section><h2>Свързана страница</h2><p><strong>{status.page.name}</strong></p><button className="amp-btn amp-btn--ghost" disabled={busy || !status.ready || originMismatch} onClick={() => void action("disconnect")}>Прекъсни връзката</button></section> : <p>Клубът още няма свързана Facebook страница.</p>}
      {!status.ready && <p role="status">Администраторът на MyTeam трябва да завърши настройката на Facebook връзката.</p>}
      {status.choosing && !originMismatch && <section><h2>Изберете страницата на този клуб</h2>
        {status.choices.length ? <ul className="amp-facebook-page-choices">{status.choices.map(page => <li key={page.id}><button className="amp-btn amp-btn--ghost" disabled={busy} onClick={() => void action("select", page.id)}>{page.name}</button></li>)}</ul> : <p>Няма страници с разрешение за публикуване. Проверете достъпа си до страницата и предоставените разрешения.</p>}
      </section>}
      <button className="amp-btn amp-facebook-publish" disabled={busy || !status.ready || originMismatch} onClick={() => void action("start")}>{busy ? "Моля, изчакайте…" : status.page || status.choosing ? "Свържи отново с Facebook" : "Свържи Facebook страница"}</button>
      <p>Използвайте Facebook профил с право да публикува от името на страницата на клуба.</p>
    </>}
  </main>;
}
