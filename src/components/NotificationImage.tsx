"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import styles from "./NotificationImage.module.css";

export function NotificationImage({ src }: { src?: string | null }) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!src) return null;
  return (
    <>
      <button type="button" aria-label="Отвори снимката" onClick={event => {
        event.stopPropagation();
        setZoom(1);
        setOpen(true);
      }} style={{ display: "block", border: 0, padding: 0, background: "transparent", maxWidth: "100%", cursor: "zoom-in" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Снимка към съобщението" loading="lazy"
          style={{ display: "block", maxWidth: "100%", maxHeight: 400, objectFit: "contain", borderRadius: 8 }} />
      </button>
      {open ? (
        <dialog ref={dialogRef} aria-label="Преглед на снимката" onCancel={() => setOpen(false)}
          onClick={event => {
            event.stopPropagation();
            if (event.target === event.currentTarget) setOpen(false);
          }}
          className={styles.dialog}>
          <header className={styles.header}>
            <span>Снимка към съобщението</span>
            <button type="button" autoFocus aria-label="Затвори прегледа" onClick={() => setOpen(false)}><X size={22} /></button>
          </header>
          <div className={styles.viewport}>
            <div className={styles.canvas} style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="Снимка към съобщението — увеличен преглед" className={styles.image} />
            </div>
          </div>
          <footer className={styles.footer}>
            <div className={styles.controls}>
              <button type="button" aria-label="Намали снимката" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}><Minus size={20} /></button>
              <output aria-live="polite">{Math.round(zoom * 100)}%</output>
              <button type="button" aria-label="Увеличи снимката" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + 0.5))}><Plus size={20} /></button>
              <span className={styles.divider} />
              <button type="button" aria-label="Нулирай увеличението" disabled={zoom === 1} onClick={() => setZoom(1)}><RotateCcw size={18} /></button>
            </div>
            <span className={styles.hint}>{zoom > 1 ? "Плъзнете, за да разгледате снимката" : "Използвайте +, за да увеличите"}</span>
          </footer>
        </dialog>
      ) : null}
    </>
  );
}
