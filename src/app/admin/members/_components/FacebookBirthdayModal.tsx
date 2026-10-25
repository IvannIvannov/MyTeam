"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, X } from "lucide-react";

type Preview = {
  connected: boolean;
  pageName: string | null;
  pageId: string | null;
  photoUrl: string | null;
  message: string;
  status: string | null;
  facebookPostId: string | null;
};

export default function FacebookBirthdayModal({ clubId, coachGroupId, playerId, playerName, birthdayDate, onClose }: {
  clubId: string; coachGroupId?: string; playerId: string; playerName: string; birthdayDate: string; onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [photoFailed, setPhotoFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitLock = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const query = new URLSearchParams({ birthdayDate, ...(coachGroupId ? { coachGroupId } : {}) });
  const endpoint = `/api/admin/clubs/${encodeURIComponent(clubId)}/birthday-facebook/${encodeURIComponent(playerId)}?${query}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Поздравлението не може да бъде заредено.");
        if (!controller.signal.aborted) { setPreview(data); setMessage(data.message); }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Поздравлението не може да бъде заредено.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [endpoint]);

  const publish = async () => {
    if (submitLock.current || !preview) return;
    submitLock.current = true;
    setPublishing(true); setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ birthdayDate, message, photoUrl: preview.photoUrl, pageId: preview.pageId }),
      });
      const data = await response.json();
      if (data.status) setPreview((previous) => previous ? { ...previous, status: data.status, facebookPostId: data.facebookPostId ?? previous.facebookPostId } : previous);
      if (!response.ok) throw new Error(data.error || "Публикуването не бе потвърдено.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Проверете Facebook страницата за резултата.");
      // A broken browser connection may hide a successful publish. Refresh server status before retrying.
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (response.ok) setPreview(await response.json());
        else setPreview((previous) => previous ? { ...previous, status: "unknown" } : previous);
      } catch { setPreview((previous) => previous ? { ...previous, status: "unknown" } : previous); }
    } finally { setPublishing(false); submitLock.current = false; }
  };

  const published = preview?.status === "published";
  const uncertain = preview?.status === "publishing" || preview?.status === "unknown";
  const disabled = loading || publishing || !preview?.connected || !preview.photoUrl || photoFailed || published || uncertain || !message.trim() || message.length > 5000;

  return (
    <dialog ref={dialogRef} className="amp-facebook-dialog" aria-labelledby="facebook-birthday-title"
      onCancel={(event) => { event.preventDefault(); if (!submitLock.current) closeRef.current(); }}>
      <div className="amp-facebook-header">
        <span className="amp-facebook-brand" aria-hidden="true"><Share2 size={22} /></span>
        <div><h2 id="facebook-birthday-title">Поздрав във Facebook</h2><p>{playerName} · {birthdayDate.split("-").reverse().join(".")}</p></div>
        <button className="amp-modal-close" type="button" autoFocus disabled={publishing} onClick={onClose} aria-label="Затвори"><X size={20} /></button>
      </div>
      {loading ? <p role="status">Зареждане на поздрава…</p> : <>
        {preview && <>
          <p className="amp-facebook-destination">Публикуване от името на <strong>{preview.pageName || "клуба"}</strong></p>
          {!preview.connected && <p className="amp-facebook-notice">Facebook страницата на клуба още не е свързана. Свържете страницата, за да можете да публикувате. <a href={`/admin/members/facebook?clubId=${encodeURIComponent(clubId)}`}>Свържи Facebook страница</a></p>}
          <div className="amp-facebook-preview">
            {preview.photoUrl && !photoFailed ? (
              // This is the same server-selected photo that Facebook will publish.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.photoUrl} alt={playerName} width={600} height={600} onError={() => setPhotoFailed(true)} />
            ) : <p className="amp-facebook-notice">{photoFailed ? "Снимката не може да бъде заредена." : "Добавете снимка на състезателя преди публикуване."}</p>}
            <label className="amp-edit-field" htmlFor="facebook-birthday-message">
              <span className="amp-lbl">Поздравление</span>
              <textarea id="facebook-birthday-message" className="amp-edit-input" rows={8} maxLength={5000} value={message}
                disabled={publishing || published || uncertain} onChange={(event) => setMessage(event.target.value)} />
            </label>
          </div>
          {published && <p className="amp-facebook-success" role="status">Поздравлението е публикувано успешно във Facebook.</p>}
          {uncertain && <p className="amp-facebook-notice" role="status">Има заявка без окончателно потвърждение. Проверете Facebook страницата с администратора, преди да публикувате отново.</p>}
        </>}
        {error && <p className="amp-confirm-error" role="alert">{error}</p>}
      </>}
      <div className="amp-facebook-actions">
        <button className="amp-btn amp-btn--ghost" type="button" disabled={publishing} onClick={onClose}>{published ? "Готово" : "Отказ"}</button>
        <button className="amp-btn amp-facebook-publish" type="button" disabled={disabled} onClick={() => void publish()}>
          <Share2 size={16} /> {publishing ? "Публикуване…" : published ? "Публикувано" : "Публикувай"}
        </button>
      </div>
    </dialog>
  );
}
