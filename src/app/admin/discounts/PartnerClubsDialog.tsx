"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, Search, Users, X } from "lucide-react";

interface Club {
  clubId: string;
  clubName: string;
  clubLogoUrl: string | null;
  configs: { discountId: string; teamGroup: number; isVisible: boolean }[];
}
interface Props {
  partner: { id: string; name: string; logoUrl: string | null; badgeText: string | null };
  teams: Club[];
  onClose: () => void;
  onSaved: () => void;
}

export default function PartnerClubsDialog({ partner, teams, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const [initial] = useState(() => new Set(teams.filter(team => team.configs.some(config => config.discountId === partner.id && config.teamGroup === 0 && config.isVisible)).map(team => team.clubId)));
  const [selected, setSelected] = useState(() => new Set(initial));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const changes = teams.filter(team => initial.has(team.clubId) !== selected.has(team.clubId));
  const filtered = teams.filter(team => team.clubName.toLocaleLowerCase("bg").includes(query.trim().toLocaleLowerCase("bg")));

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  const toggle = (id: string) => {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/discounts/clubs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: partner.id, changes: changes.map(team => ({ clubId: team.clubId, isVisible: selected.has(team.clubId) })) }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Промените не бяха запазени.");
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверете връзката си и опитайте отново.");
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="partner-club-dialog"
      aria-labelledby="partner-club-title"
      onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}
      onPointerDown={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        backdropPress.current = event.target === event.currentTarget && (
          event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom
        );
      }}
      onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom;
        if (backdropPress.current && outside && event.target === event.currentTarget && !saving) onClose();
        backdropPress.current = false;
      }}
    >
      <header className="pcd-header">
        <div className="pcd-partner-logo">{partner.logoUrl ? <img src={partner.logoUrl} alt="" /> : <Users size={28} />}</div>
        <div className="pcd-title">
          <span className="pcd-eyebrow">КЛУБОВЕ НА ПАРТНЬОРА</span>
          <h2 id="partner-club-title">{partner.name}</h2>
          {partner.badgeText && <span className="pcd-badge">{partner.badgeText}</span>}
        </div>
        <button type="button" className="pcd-close" aria-label="Затвори" disabled={saving} onClick={onClose}><X size={22} /></button>
      </header>
      <div className="pcd-toolbar">
        <p>Избери клубовете, които получават тази отстъпка.</p>
        <label className="pcd-search"><Search size={18} /><input autoFocus type="search" aria-label="Търси клуб" placeholder="Търси клуб по име..." value={query} onChange={event => setQuery(event.target.value)} /></label>
      </div>
      <div className="pcd-columns">
        {[true, false].map(isSelected => {
          const clubs = filtered.filter(team => selected.has(team.clubId) === isSelected);
          return (
            <section key={String(isSelected)} className={`pcd-column ${isSelected ? "pcd-selected" : ""}`}>
              <h3>{isSelected ? <Check size={16} /> : <Plus size={16} />}{isSelected ? "Избрани клубове" : "Добави клубове"}<span>{isSelected ? selected.size : teams.length - selected.size}</span></h3>
              <ul>
                {clubs.map(club => (
                  <li key={club.clubId}>
                    <button type="button" className="pcd-club" disabled={saving} aria-label={`${isSelected ? "Премахни" : "Добави"} ${club.clubName}`} onClick={() => toggle(club.clubId)}>
                      <span className="pcd-club-logo">{club.clubLogoUrl ? <img src={club.clubLogoUrl} alt="" /> : <Users size={20} />}</span>
                      <span className="pcd-club-name">{club.clubName}</span>
                      <span className="pcd-club-action">{isSelected ? <X size={16} /> : <Plus size={16} />}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {clubs.length === 0 && <p className="pcd-empty">{query.trim() ? "Няма клубове за това търсене." : isSelected ? "Все още няма избрани клубове. Добави от списъка с клубове." : "Всички клубове вече са избрани."}</p>}
            </section>
          );
        })}
      </div>
      {error && <p className="pcd-error" role="alert">{error}</p>}
      <footer className="pcd-footer">
        <span aria-live="polite">{changes.length ? `${changes.length} незапазени промени` : `${selected.size} избрани клуба`}</span>
        <div><button type="button" className="pcd-cancel" disabled={saving} onClick={onClose}>Отказ</button><button type="button" className="pcd-save" disabled={saving || changes.length === 0} onClick={() => void save()}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{saving ? "Запазване..." : "Запази промените"}</button></div>
      </footer>
    </dialog>
  );
}
