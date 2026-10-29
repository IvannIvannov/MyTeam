"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Edit2, Trash2, Check, X, GripVertical, ArrowLeft, Settings2, Users, Upload, Loader2 } from "lucide-react";
import { uploadImage } from "@/lib/uploadImage";
import PartnerClubsDialog from "./PartnerClubsDialog";
import "./page.css";

interface PartnerDiscount {
  id: string;
  name: string;
  logoUrl: string | null;
  badgeText: string | null;
  description: string | null;
  code: string | null;
  validUntil: string | null;
  storeUrl: string | null;
  terms: string[];
  themeColor: string | null;
}

interface TeamConfig {
  discountId: string;
  teamGroup: number;
  order: number;
  isVisible: boolean;
  discount?: PartnerDiscount;
}

interface Team {
  clubId: string;
  teamGroup: number;
  clubName: string;
  clubLogoUrl: string | null;
  configs: TeamConfig[];
}

export default function DiscountsPageClient() {
  const router = useRouter();
  const [partners, setPartners] = useState<PartnerDiscount[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPartner, setEditingPartner] = useState<Partial<PartnerDiscount> | null>(null);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragY, setDragY] = useState(0);
  const [startY, setStartY] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [badgeIsText, setBadgeIsText] = useState(false);
  const [teamSearch, setTeamSearch] = useState("");
  const [clubPartner, setClubPartner] = useState<PartnerDiscount | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [partnersRes, teamsRes] = await Promise.all([
        fetch("/api/admin/discounts"),
        fetch("/api/admin/teams/discounts"),
      ]);
      const partnersData = await partnersRes.json();
      const teamsData = await teamsRes.json();
      
      setPartners(Array.isArray(partnersData) ? partnersData : []);
      setTeams(Array.isArray(teamsData) ? teamsData : []);
    } catch (error) {
      console.error("Fetch data error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePartner = async () => {
    if (!editingPartner?.name) return;
    setSaving(true);
    try {
      const method = editingPartner.id ? "PUT" : "POST";
      const url = "/api/admin/discounts";
      
      // Ensure badgeText is formatted with - and % if it's just a number
      const payload = {
        ...editingPartner,
        badgeText: badgeIsText
          ? (editingPartner.badgeText || null)
          : (editingPartner.badgeText?.startsWith('-') ? editingPartner.badgeText : `-${editingPartner.badgeText}%`),
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setEditingPartner(null);
        fetchData();
      }
    } catch (error) {
      console.error("Save partner error:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePartner = async (id: string) => {
    if (!confirm("Сигурни ли сте, че искате да изтриете този партньор?")) return;
    try {
      const res = await fetch(`/api/admin/discounts?id=${id}`, { method: "DELETE" });
      if (res.ok) fetchData();
    } catch (error) {
      console.error("Delete partner error:", error);
    }
  };

  const handleImageUpload = async (file: File) => {
    setSaving(true);
    try {
      const response = await uploadImage(file, "club", editingPartner?.name || "partner-logo");
      setEditingPartner({ ...editingPartner, logoUrl: response.secure_url });
    } catch (error) {
      alert("Грешка при качване: " + (error instanceof Error ? error.message : "Неизвестна грешка"));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTeamConfig = async () => {
    if (!editingTeam) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/teams/discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clubId: editingTeam.clubId,
          teamGroup: 0, // Set to 0 for entire club
          discountConfigs: editingTeam.configs.map((c, i) => ({
            discountId: c.discountId,
            order: i,
            isVisible: c.isVisible,
          })),
        }),
      });

      if (res.ok) {
        setEditingTeam(null);
        fetchData();
      }
    } catch (error) {
      console.error("Save team config error:", error);
    } finally {
      setSaving(false);
    }
  };

  const moveConfig = (index: number, direction: "up" | "down") => {
    if (!editingTeam) return;
    const newConfigs = [...editingTeam.configs];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newConfigs.length) return;
    
    [newConfigs[index], newConfigs[targetIndex]] = [newConfigs[targetIndex], newConfigs[index]];
    setEditingTeam({ ...editingTeam, configs: newConfigs });
  };

  const toggleVisibility = (index: number) => {
    if (!editingTeam) return;
    const newConfigs = [...editingTeam.configs];
    newConfigs[index].isVisible = !newConfigs[index].isVisible;
    setEditingTeam({ ...editingTeam, configs: newConfigs });
  };

  const addDiscountToTeam = (discountId: string) => {
    if (!editingTeam) return;
    if (editingTeam.configs.some(c => c.discountId === discountId)) return;
    
    const discount = partners.find(p => p.id === discountId);
    const newConfigs = [...editingTeam.configs, {
      discountId,
      teamGroup: 0,
      order: editingTeam.configs.length,
      isVisible: true,
      discount
    }];
    setEditingTeam({ ...editingTeam, configs: newConfigs });
  };

  const removeDiscountFromTeam = (index: number) => {
    if (!editingTeam) return;
    const newConfigs = editingTeam.configs.filter((_, i) => i !== index);
    setEditingTeam({ ...editingTeam, configs: newConfigs });
  };

  if (loading) {
    return (
      <div className="discounts-admin">
        <div className="admin-container">
          <p>Зареждане...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="discounts-admin">
      <div className="admin-container">
        <header className="admin-header">
          <div>
            <button 
              onClick={() => router.push('/admin/players')}
              style={{ 
                background: "rgba(255,255,255,0.05)", 
                color: "rgba(255,255,255,0.6)", 
                border: "1px solid rgba(255,255,255,0.1)", 
                padding: "6px 12px", 
                borderRadius: "8px", 
                display: "flex", 
                alignItems: "center", 
                gap: "6px",
                cursor: "pointer",
                width: "fit-content",
                fontSize: "13px",
                fontWeight: "600",
                marginBottom: "15px"
              }}
            >
              <ArrowLeft size={14} /> Назад
            </button>
            <h1 className="admin-title">Управление на отстъпки</h1>
            <p style={{ color: "#666", marginTop: "4px" }}>Настройте кои отстъпки да се виждат за всеки отбор.</p>
          </div>
          <button className="add-btn" onClick={() => { setEditingPartner({}); setBadgeIsText(false); }}>
            <Plus size={20} />
            Добави партньор
          </button>
        </header>

        <section className="section-card">
          <h3 className="section-title"><Settings2 size={20} /> Партньори</h3>
          <div className="partners-grid">
            {partners.map(partner => (
                <div 
                key={partner.id} 
                className="partner-card"
                style={{
                  backgroundImage: `linear-gradient(to bottom, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0.9)), url(${partner.logoUrl || "/placeholder.webp"})`,
                  backgroundSize: "contain",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: "170px",
                  position: "relative",
                  overflow: "hidden",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "16px",
                  padding: "20px",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.5)"
                }}
              >
                <button type="button" className="partner-card-open" aria-label={`Управление на клубовете за ${partner.name}`} onClick={() => setClubPartner(partner)} />
                <div style={{ position: "relative", zIndex: 2, textAlign: "center", width: "100%", pointerEvents: "none" }}>
                  <div className="partner-name" style={{ 
                    fontSize: "18px", 
                    fontWeight: "800", 
                    marginBottom: "10px", 
                    color: "#fff",
                    textShadow: "0 2px 8px rgba(0,0,0,0.8)",
                    letterSpacing: "0.5px",
                    textTransform: "uppercase"
                  }}>
                    {partner.name}
                  </div>
                  <div className="partner-badge" style={{ 
                    display: "inline-block", 
                    background: "rgba(50, 205, 50, 0.9)", 
                    color: "#000", 
                    padding: "6px 16px", 
                    borderRadius: "10px", 
                    fontSize: "13px", 
                    fontWeight: "800",
                    boxShadow: "0 4px 12px rgba(50, 205, 50, 0.3)"
                  }}>
                    {partner.badgeText || "Няма отстъпка"}
                  </div>
                  <p className="partner-card-clubs-hint"><Users size={14} /> {teams.filter(team => team.configs.some(config => config.discountId === partner.id && config.teamGroup === 0 && config.isVisible)).length} клуба · Управлявай</p>
                  <div style={{ marginTop: "16px", display: "flex", gap: "12px", justifyContent: "center", pointerEvents: "auto" }}>
                    <button className="order-btn" style={{ background: "rgba(50, 150, 255, 0.2)", color: "#4dabf7", width: "36px", height: "36px", borderRadius: "10px" }} onClick={() => { setEditingPartner(partner); setBadgeIsText(!/^-\d+%$/.test(partner.badgeText || "")); }}><Edit2 size={18} /></button>
                    <button className="order-btn" style={{ background: "rgba(255, 68, 68, 0.2)", color: "#ff6666", width: "36px", height: "36px", borderRadius: "10px" }} onClick={() => handleDeletePartner(partner.id)}><Trash2 size={18} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", gap: "16px", flexWrap: "wrap" }}>
            <h3 className="section-title" style={{ margin: 0 }}><Users size={20} /> Настройка по отбори</h3>
            <input
              type="text"
              className="form-input"
              style={{ width: "240px", fontSize: "14px" }}
              placeholder="Търси отбор..."
              aria-label="Търси отбор"
              value={teamSearch}
              onChange={e => setTeamSearch(e.target.value)}
            />
          </div>
          <div className="teams-list">
            {teams.filter(t => t.clubName.toLowerCase().includes(teamSearch.toLowerCase())).map(team => (
              <div key={`${team.clubId}`} className="team-row">
                <div className="team-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                    <div className="partner-logo-wrap" style={{ width: "70px", height: "70px", margin: 0, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      {team.clubLogoUrl ? (
                        <img src={team.clubLogoUrl} alt={team.clubName} className="partner-logo" />
                      ) : (
                        <Users size={32} style={{ color: "#333" }} />
                      )}
                    </div>
                    <div className="team-info" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <h4 style={{ fontSize: "24px", color: "#fff", fontWeight: "800", margin: 0 }}>{team.clubName}</h4>
                      <p style={{ fontSize: "15px", color: "rgba(255,255,255,0.5)", fontWeight: "500", margin: 0 }}>{team.configs.filter(c => c.isVisible).length} активни отстъпки</p>
                    </div>
                  </div>
                  <button className="add-btn" style={{ background: "#32cd32", color: "#000", fontWeight: "800", boxShadow: "0 0 20px rgba(50, 205, 50, 0.4)" }} onClick={() => {
                          // Auto-populate all partners if missing
                          const allPartnerIds = partners.map(p => p.id);
                          const existingIds = team.configs.map(c => c.discountId);
                          const missingIds = allPartnerIds.filter(id => !existingIds.includes(id));
                          
                          const fullConfigs = [
                            ...team.configs,
                            ...missingIds.map((id, idx) => ({
                              discountId: id,
                              teamGroup: 0,
                              order: team.configs.length + idx,
                              isVisible: false
                            }))
                          ];
                          
                          setEditingTeam({ ...team, configs: fullConfigs });
                        }}>
                    Настрой
                  </button>
                </div>
                
                <div className="team-discounts" style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  {team.configs.filter(c => c.isVisible).sort((a,b) => a.order - b.order).map(config => (
                    <div key={config.discountId} className="discount-tag" style={{ background: "rgba(50, 205, 50, 0.1)", color: "#32cd32", border: "1px solid rgba(50, 205, 50, 0.2)", padding: "6px 12px", borderRadius: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                      <img src={config.discount?.logoUrl || "/placeholder.webp"} alt="" style={{ width: "16px", height: "16px", objectFit: "contain" }} />
                      <span style={{ fontWeight: "600", fontSize: "13px" }}>{config.discount?.name}</span>
                    </div>
                  ))}
                  {team.configs.filter(c => c.isVisible).length === 0 && (
                    <div style={{ padding: "12px", background: "rgba(255,255,255,0.02)", borderRadius: "8px", fontSize: "14px", color: "rgba(255,255,255,0.2)", width: "100%", textAlign: "center", border: "1px dashed rgba(255,255,255,0.05)" }}>
                      Няма настроени активни отстъпки.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {clubPartner && (
        <PartnerClubsDialog partner={clubPartner} teams={teams} onClose={() => setClubPartner(null)} onSaved={() => { setClubPartner(null); void fetchData(); }} />
      )}

      {/* Partner Edit Modal */}
      {editingPartner && (
        <div className="modal-overlay" onClick={() => setEditingPartner(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditingPartner(null)}><X size={24} /></button>
            <h2 style={{ marginBottom: "25px", color: "#32cd32", textAlign: "center", fontSize: "28px", fontWeight: "800" }}>
              {editingPartner.id ? "Редактирай партньор" : "Нов партньор"}
            </h2>
            
            <div className="form-group">
              <label className="form-label">Име на партньора</label>
              <input 
                className="form-input" 
                value={editingPartner.name || ""} 
                onChange={e => setEditingPartner({...editingPartner, name: e.target.value})}
                placeholder="напр. Sport Depot"
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Лого</label>
              <div 
                className="clickable-upload-area" 
                onClick={() => document.getElementById('partner-logo-input')?.click()}
                style={{
                  width: "100%",
                  height: "150px",
                  background: "rgba(255,255,255,0.03)",
                  border: "2px dashed rgba(50, 205, 50, 0.3)",
                  borderRadius: "16px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  overflow: "hidden",
                  position: "relative"
                }}
              >
                <input 
                  type="file" 
                  id="partner-logo-input" 
                  style={{ display: "none" }} 
                  accept="image/*"
                  onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
                />
                
                {editingPartner.logoUrl ? (
                  <img src={editingPartner.logoUrl} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "contain", padding: "10px" }} />
                ) : (
                  <div style={{ textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                    <Upload size={32} style={{ marginBottom: "8px", color: "#32cd32" }} />
                    <p style={{ fontSize: "14px", fontWeight: "500" }}>Натиснете за избор на лого</p>
                  </div>
                )}
                
                {saving && (
                  <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Loader2 className="animate-spin" color="#32cd32" size={32} />
                  </div>
                )}
              </div>
            </div>
            
            <div className="form-group" style={{ maxWidth: "400px", margin: "0 auto 20px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label className="form-label">Отстъпка</label>
                  {badgeIsText ? (
                    <input
                      type="text"
                      className="form-input"
                      style={{ textAlign: "center", fontWeight: "700" }}
                      value={editingPartner.badgeText || ""}
                      onChange={e => setEditingPartner({ ...editingPartner, badgeText: e.target.value })}
                      placeholder="Партньорска цена"
                    />
                  ) : (
                    <div style={{ position: "relative" }}>
                      <input
                        type="text"
                        className="form-input"
                        style={{ paddingLeft: "28px", paddingRight: "28px", textAlign: "center", fontWeight: "700" }}
                        value={editingPartner.badgeText?.replace(/[^0-9]/g, '') || ""}
                        onChange={e => setEditingPartner({ ...editingPartner, badgeText: e.target.value.replace(/[^0-9]/g, '') })}
                        placeholder="10"
                      />
                      <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#32cd32", fontWeight: "900", pointerEvents: "none" }}>-</span>
                      <span style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", color: "#32cd32", fontWeight: "900", pointerEvents: "none" }}>%</span>
                    </div>
                  )}
                </div>
                <div>
                  <label className="form-label">Валидна до</label>
                  <input
                    type="date"
                    className="form-input"
                    style={{ textAlign: "center" }}
                    value={editingPartner.validUntil ? new Date(editingPartner.validUntil).toISOString().split('T')[0] : ""}
                    onChange={e => setEditingPartner({ ...editingPartner, validUntil: e.target.value })}
                  />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "10px" }}>
                <span style={{ fontSize: "12px", color: badgeIsText ? "rgba(255,255,255,0.35)" : "#32cd32", fontWeight: "700", transition: "color 0.2s" }}>%</span>
                <div
                  onClick={() => { setBadgeIsText(!badgeIsText); setEditingPartner({ ...editingPartner, badgeText: "" }); }}
                  style={{ width: "36px", height: "20px", background: badgeIsText ? "#32cd32" : "rgba(255,255,255,0.1)", borderRadius: "10px", position: "relative", cursor: "pointer", transition: "background 0.2s" }}
                >
                  <div style={{ width: "14px", height: "14px", background: badgeIsText ? "#000" : "rgba(255,255,255,0.5)", borderRadius: "50%", position: "absolute", top: "3px", left: badgeIsText ? "19px" : "3px", transition: "left 0.2s" }} />
                </div>
                <span style={{ fontSize: "12px", color: badgeIsText ? "#32cd32" : "rgba(255,255,255,0.35)", fontWeight: "700", transition: "color 0.2s" }}>Текст</span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Промо код</label>
              <input 
                className="form-input" 
                value={editingPartner.code || ""} 
                onChange={e => setEditingPartner({...editingPartner, code: e.target.value})}
                placeholder="MYTEAM10"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Уебсайт (незадължително)</label>
              <input 
                type="url"
                className="form-input" 
                value={editingPartner.storeUrl || ""} 
                onChange={e => setEditingPartner({...editingPartner, storeUrl: e.target.value || null})}
                placeholder="https://example.com"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Цвят на темата</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
                {["#ff4d4d","#ff6d00","#ffca28","#c6ff00","#32cd32","#00e5ff","#2979ff","#651fff","#d500f9","#ff4081","#ffffff","#aaaaaa","#e53935","#f57c00","#fdd835","#69f0ae","#00bcd4","#1565c0","#6a1b9a","#ad1457","#ff6e40","#546e7a"].map(color => {
                  const active = (editingPartner.themeColor || "").toLowerCase() === color.toLowerCase();
                  return (
                    <div
                      key={color}
                      onClick={() => setEditingPartner({ ...editingPartner, themeColor: color })}
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "8px",
                        background: color,
                        cursor: "pointer",
                        border: active ? "2px solid #fff" : "2px solid transparent",
                        boxShadow: active ? `0 0 0 2px ${color}` : "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        transition: "transform 0.15s",
                      }}
                      title={color}
                    >
                      {active && <Check size={14} color={color === "#ffffff" || color === "#ffca28" || color === "#c6ff00" || color === "#fdd835" ? "#000" : "#fff"} strokeWidth={3} />}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <input
                  type="text"
                  className="form-input"
                  style={{ flex: 1, fontFamily: "monospace", fontSize: "14px" }}
                  value={editingPartner.themeColor || ""}
                  onChange={e => setEditingPartner({ ...editingPartner, themeColor: e.target.value })}
                  placeholder="#ff4d4d"
                />
                <div style={{
                  width: "47px",
                  height: "47px",
                  flexShrink: 0,
                  borderRadius: "10px",
                  background: editingPartner.themeColor || "#ff4d4d",
                  border: "2px solid rgba(255,255,255,0.1)",
                  boxShadow: `0 0 15px ${(editingPartner.themeColor || "#ff4d4d")}44`
                }} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Условия (напишете и натиснете Enter)</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
                {editingPartner.terms?.map((term, i) => (
                  <div key={i} style={{ 
                    background: "rgba(255,255,255,0.03)", 
                    padding: "10px 16px", 
                    borderRadius: "10px", 
                    fontSize: "14px", 
                    display: "flex", 
                    alignItems: "flex-start", 
                    justifyContent: "space-between",
                    gap: "12px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    width: "100%"
                  }}>
                    <span style={{ textAlign: "left", flex: 1, color: "rgba(255,255,255,0.9)", lineHeight: "1.4" }}>{term}</span>
                    <button 
                      onClick={() => {
                        const newTerms = [...(editingPartner.terms || [])];
                        newTerms.splice(i, 1);
                        setEditingPartner({...editingPartner, terms: newTerms});
                      }}
                      style={{ background: "none", border: "none", color: "#ff4d4d", cursor: "pointer", display: "flex", padding: "2px", opacity: 0.6 }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <input 
                className="form-input" 
                placeholder="напр. Важи само за нови клиенти"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = e.currentTarget.value.trim();
                    if (val) {
                      setEditingPartner({
                        ...editingPartner, 
                        terms: [...(editingPartner.terms || []), val]
                      });
                      e.currentTarget.value = '';
                    }
                  }
                }}
              />
            </div>

            <button 
              className="save-btn" 
              onClick={handleSavePartner} 
              disabled={saving}
              style={{ background: "#32cd32", color: "#000", fontWeight: "800", marginTop: "20px" }}
            >
              {saving ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}><Loader2 className="animate-spin" /> Запазване...</div> : "Запази партньор"}
            </button>
          </div>
        </div>
      )}

      {/* Team Config Modal */}
      {editingTeam && (
        <div className="modal-overlay" onClick={() => setEditingTeam(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditingTeam(null)}><X size={24} /></button>
            
            <div style={{ marginBottom: "30px", textAlign: "center" }}>
              <h2 style={{ color: "#32cd32", fontSize: "28px", fontWeight: "900", marginBottom: "8px" }}>Настройка за {editingTeam.clubName}</h2>
              <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "14px" }}>Включете отстъпките за този отбор и ги подредете.</p>
            </div>

            <div 
              className="config-list" 
              style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "30px", position: "relative" }}
              onPointerMove={(e) => {
                if (!draggingId || dragIndex === null) return;
                const deltaY = e.clientY - startY;
                setDragY(deltaY);

                const rowHeight = 66; 
                const newIndex = Math.max(0, Math.min(editingTeam.configs.length - 1, Math.round(dragIndex + deltaY / rowHeight)));
                
                if (newIndex !== dragIndex) {
                  const newConfigs = [...editingTeam.configs].sort((a,b) => a.order - b.order);
                  const [moved] = newConfigs.splice(dragIndex, 1);
                  newConfigs.splice(newIndex, 0, moved);
                  const finalConfigs = newConfigs.map((c, idx) => ({ ...c, order: idx }));
                  
                  // COMPENSATE STARTY TO KEEP IT STICKY
                  const diff = (newIndex - dragIndex) * rowHeight;
                  setStartY(prev => prev + diff);
                  setDragY(deltaY - diff);
                  setDragIndex(newIndex);
                  setEditingTeam({ ...editingTeam, configs: finalConfigs });
                }
              }}
              onPointerUp={() => {
                setDraggingId(null);
                setDragY(0);
                setDragIndex(null);
              }}
              onPointerLeave={() => {
                setDraggingId(null);
                setDragY(0);
                setDragIndex(null);
              }}
            >
              {editingTeam.configs.sort((a,b) => a.order - b.order).map((config, index) => {
                const partner = partners.find(p => p.id === config.discountId);
                if (!partner) return null;
                
                const isDragging = draggingId === config.discountId;

                return (
                  <div 
                    key={config.discountId} 
                    onPointerDown={(e) => {
                      setDraggingId(config.discountId);
                      setDragIndex(index);
                      setStartY(e.clientY);
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    className={`config-item ${isDragging ? 'dragging' : ''}`}
                    style={{ 
                      background: isDragging ? "rgba(50, 205, 50, 0.12)" : "rgba(255,255,255,0.03)", 
                      border: isDragging ? "2px solid #32cd32" : "1px solid rgba(255,255,255,0.08)", 
                      padding: "12px 16px", 
                      borderRadius: "16px", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "space-between",
                      cursor: "grab",
                      transition: isDragging ? "none" : "transform 0.4s cubic-bezier(0.2, 1, 0.2, 1), background 0.2s",
                      transform: isDragging ? `translateY(${dragY}px) scale(1.04)` : "none",
                      boxShadow: isDragging ? "0 20px 60px rgba(0, 0, 0, 0.5), 0 0 30px rgba(50, 205, 50, 0.3)" : "none",
                      zIndex: isDragging ? 100 : 1,
                      touchAction: "none",
                      willChange: "transform",
                      userSelect: "none",
                      WebkitUserSelect: "none"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "15px", pointerEvents: "none" }}>
                      <GripVertical size={16} style={{ color: isDragging ? "#32cd32" : "rgba(255,255,255,0.2)" }} />
                      <div className="partner-logo-wrap" style={{ width: "40px", height: "40px", margin: 0, background: "rgba(255,255,255,0.05)" }}>
                        <img src={partner.logoUrl || "/placeholder.webp"} alt="" className="partner-logo" />
                      </div>
                      <div style={{ color: config.isVisible ? "#fff" : "rgba(255,255,255,0.3)", fontSize: "16px", fontWeight: "700" }}>
                        {partner.name}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                      <div 
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          const newConfigs = editingTeam.configs.map(c => 
                            c.discountId === config.discountId ? { ...c, isVisible: !c.isVisible } : c
                          );
                          setEditingTeam({ ...editingTeam, configs: newConfigs });
                        }}
                        style={{ 
                          width: "44px", 
                          height: "24px", 
                          background: config.isVisible ? "#32cd32" : "rgba(255,255,255,0.1)", 
                          borderRadius: "12px", 
                          position: "relative", 
                          cursor: "pointer",
                          transition: "all 0.3s"
                        }}
                      >
                        <div style={{ 
                          width: "18px", 
                          height: "18px", 
                          background: config.isVisible ? "#000" : "rgba(255,255,255,0.4)", 
                          borderRadius: "50%", 
                          position: "absolute", 
                          top: "3px", 
                          left: config.isVisible ? "23px" : "3px",
                          transition: "all 0.3s"
                        }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>


            <button 
              className="save-btn" 
              onClick={handleSaveTeamConfig} 
              disabled={saving}
              style={{ background: "#32cd32", color: "#000", fontWeight: "800", height: "54px" }}
            >
              {saving ? "Запазване..." : "Запази промените"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
