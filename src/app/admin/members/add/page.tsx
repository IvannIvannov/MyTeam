"use client";

import { playerFieldEnabled, parsePlayerWeight } from "@/lib/playerFields";
import PlayerExtraFields from "@/components/PlayerExtraFields";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { uploadImage, validateImageFile } from "@/lib/uploadImage";
import { extractUploadPathFromCloudinaryUrl } from "@/lib/cloudinaryImagePath";
import "./page.css";

interface ClubData {
  playerFields?: string[];
  id: string;
  name: string;
  imageUrl?: string | null;
  billingStatus?: "demo" | "active";
  firstBillingMonth?: string | null;
  paymentWorkflow?: string | null;
}

interface CustomGroup {
  id: string;
  name: string;
}

interface DuplicateMember {
  id: string;
  fullName: string;
  birthDate: string | null;
}

function normalizePlayerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("bg-BG");
}

function normalizeDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function AddMemberPageContent() {
  const searchParams = useSearchParams();
  const clubId = searchParams.get("clubId")?.trim() ?? "";
  const coachGroupId = searchParams.get("coachGroupId")?.trim() ?? "";
  const [fullName, setFullName] = useState("");
  const [status, setStatus] = useState<"paid" | "warning" | "overdue">("warning");
  const [clubData, setClubData] = useState<ClubData | null>(null);
  const [rank, setRank] = useState("");
  const [weight, setWeight] = useState("");
  const [teamGroup, setTeamGroup] = useState<string | null>(null);
  const [jerseyNumber, setJerseyNumber] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [playerPhone, setPlayerPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [firstBillingMonth, setFirstBillingMonth] = useState("");
  const [avatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateMember | null>(null);
  const [isClubValidated, setIsClubValidated] = useState(false);
  const [isValidatingClubId, setIsValidatingClubId] = useState(true);
  const [customGroups, setCustomGroups] = useState<CustomGroup[]>([]);
  const [selectedCustomGroupIds, setSelectedCustomGroupIds] = useState<Set<string>>(new Set());
  const [customGroupDropdownOpen, setCustomGroupDropdownOpen] = useState(false);
  const router = useRouter();
  const returnUrl = `/admin/members?clubId=${encodeURIComponent(clubId)}${coachGroupId ? `&coachGroupId=${encodeURIComponent(coachGroupId)}` : ""}`;
  useEffect(() => {
    let isActive = true;

    const validateClubId = async () => {
      if (!clubId) {
        router.replace("/404");
        return;
      }

      setIsValidatingClubId(true);
      try {
        const response = await fetch("/api/admin/clubs", { cache: "no-store" });
        if (!response.ok) {
          router.replace("/404");
          return;
        }

        const clubsPayload: unknown = await response.json();
        const currentClub = Array.isArray(clubsPayload) && clubsPayload.find((club) => {
          const item =
            typeof club === "object" && club !== null
              ? (club as { id?: unknown })
              : {};
          return String(item.id ?? "") === clubId;
        });

        if (!currentClub) {
          router.replace("/404");
          return;
        }

        if (!isActive) {
          return;
        }

        const raw = currentClub as Record<string, unknown>;
        const billingStatus = raw.billingStatus === "active" ? "active" : "demo";
        const clubFirstBillingMonth = typeof raw.firstBillingMonth === "string"
          ? raw.firstBillingMonth.slice(0, 7)
          : raw.firstBillingMonth instanceof Date
            ? raw.firstBillingMonth.toISOString().slice(0, 7)
            : null;
        setClubData({
          playerFields: Array.isArray(raw.playerFields) ? raw.playerFields.map(String) : [],
          id: String(raw.id ?? ""),
          name: String(raw.name ?? "Отбор"),
          imageUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : null,
          billingStatus,
          firstBillingMonth: clubFirstBillingMonth,
          paymentWorkflow: typeof raw.paymentWorkflow === "string" ? raw.paymentWorkflow : null,
        });
        setIsClubValidated(true);

        if (coachGroupId) {
          try {
            const groupsRes = await fetch(`/api/admin/clubs/${clubId}/custom-training-groups?coachGroupId=${encodeURIComponent(coachGroupId)}`, { cache: "no-store" });
            if (groupsRes.ok) {
              const groupsData: unknown = await groupsRes.json();
              if (Array.isArray(groupsData)) {
                setCustomGroups(
                  (groupsData as Array<{ id: string; name: string }>).map((g) => ({
                    id: g.id,
                    name: g.name,
                  })),
                );
              }
            }
          } catch {
            // groups are optional, ignore errors
          }
        }
      } catch (validationError) {
        console.error("Failed to validate club id:", validationError);
        router.replace("/404");
      } finally {
        if (isActive) {
          setIsValidatingClubId(false);
        }
      }
    };

    void validateClubId();

    return () => {
      isActive = false;
    };
  }, [clubId, router]);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [avatarFile]);

  const findActiveDuplicateMember = async (): Promise<DuplicateMember | null> => {
    const params = new URLSearchParams({ clubId });
    const response = await fetch(`/api/admin/members?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const members = await response.json();
    if (!Array.isArray(members)) {
      return null;
    }

    const normalizedFullName = normalizePlayerName(fullName);
    const normalizedBirthDate = normalizeDateInput(birthDate);
    const duplicate = members.find((member) => {
      if (typeof member !== "object" || member === null) {
        return false;
      }
      const raw = member as Record<string, unknown>;
      return (
        raw.isActive === true &&
        normalizePlayerName(String(raw.fullName ?? "")) === normalizedFullName &&
        normalizeDateInput(typeof raw.birthDate === "string" ? raw.birthDate : null) === normalizedBirthDate
      );
    }) as Record<string, unknown> | undefined;

    if (!duplicate) {
      return null;
    }

    return {
      id: String(duplicate.id ?? ""),
      fullName: String(duplicate.fullName ?? fullName),
      birthDate: typeof duplicate.birthDate === "string" ? duplicate.birthDate : null,
    };
  };

  const submitMember = async (skipDuplicateCheck = false) => {
    setIsSubmitting(true);
    setError("");

    let confirmDuplicate = false;
    try {
      if (!skipDuplicateCheck) {
        const duplicate = await findActiveDuplicateMember();
        if (duplicate) {
          setDuplicateWarning(duplicate);
          setIsSubmitting(false);
          return;
        }
      } else {
        confirmDuplicate = true;
      }
    } catch (duplicateCheckError) {
      console.error("Failed to check duplicate player:", duplicateCheckError);
    }

    try {
      if (playerFieldEnabled(clubData, "weight")) parsePlayerWeight(weight);
      let resolvedAvatarUrl = avatarUrl.trim();
      let resolvedImagePublicId = "";
      let resolvedImagePath = "";
      if (avatarFile) {
        const uploaded = await uploadImage(
          avatarFile,
          "player",
          fullName.trim() || avatarFile.name,
        );
        resolvedAvatarUrl = uploaded.secure_url;
        resolvedImagePublicId = uploaded.public_id;
        resolvedImagePath = extractUploadPathFromCloudinaryUrl(uploaded.secure_url);
      }

      const payload: Record<string, string | boolean> = {
        fullName: fullName.trim(),
        status,
        clubId,
      };
      if (birthDate.trim()) payload.birthDate = birthDate.trim();
      if (parentPhone.trim()) payload.parentPhone = parentPhone.trim();
      if (coachGroupId) payload.coachGroupId = coachGroupId;

      if (playerFieldEnabled(clubData, "rank")) payload.rank = rank.trim();
      if (playerFieldEnabled(clubData, "weight")) payload.weight = weight.trim();
      if (playerFieldEnabled(clubData, "teamGroup")) payload.teamGroup = teamGroup?.trim() ?? birthDate.slice(0, 4);
      if (playerFieldEnabled(clubData, "jerseyNumber") && jerseyNumber.trim()) payload.jerseyNumber = jerseyNumber.trim();
      if (playerPhone.trim()) payload.playerPhone = playerPhone.trim();
      if (firstBillingMonth.trim()) payload.firstBillingMonth = firstBillingMonth.trim();
      if (resolvedAvatarUrl) payload.avatarUrl = resolvedAvatarUrl;
      if (resolvedImagePath) payload.imageUrl = resolvedImagePath;
      if (resolvedImagePublicId) payload.imagePublicId = resolvedImagePublicId;
      if (confirmDuplicate) payload.confirmDuplicate = true;

      const response = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        if (selectedCustomGroupIds.size > 0) {
          try {
            const created = await response.json() as { id?: string };
            const newPlayerId = created.id;
            if (newPlayerId) {
              await Promise.all(
                [...selectedCustomGroupIds].map((groupId) =>
                  fetch(`/api/admin/clubs/${clubId}/custom-training-groups/${groupId}/players`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerId: newPlayerId }),
                  }),
                ),
              );
            }
          } catch {
            // non-fatal, player was created
          }
        }
        router.push(returnUrl);
      } else {
        const data = await response.json();
        if (response.status === 409 && data?.error === "duplicate_player") {
          setError("Вече има активен състезател със същото име и дата на раждане. Потвърдете предупреждението и опитайте отново.");
          return;
        }
        setError(data.error || "Грешка при създаване на състезател");
      }
    } catch (err) {
      setError("Възникна грешка. Моля опитайте отново.");
      console.error("Error creating player:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!isClubValidated) {
      return;
    }
    await submitMember(false);
  };

  const handleConfirmDuplicateCreate = async () => {
    setDuplicateWarning(null);
    await submitMember(true);
  };

  if (isValidatingClubId || !isClubValidated) {
    return (
      <div className="add-member-page">
        <div className="add-member-dot-grid" />
        <div className="add-member-inner" style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
          <p className="add-member-hint">Зареждане...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="add-member-page">
      <div className="add-member-dot-grid" />

      <div className="add-member-inner">
        {/* Header */}
        <div className="add-member-header">
          {clubData?.imageUrl ? (
            <img
              src={clubData.imageUrl}
              alt={clubData.name}
              className="add-member-logo"
              style={{ objectFit: "contain", borderRadius: "8px" }}
            />
          ) : (
            <img
              src="/myteam-logo.webp"
              alt="MyTeam Logo"
              className="add-member-logo"
              style={{ objectFit: "contain", borderRadius: "8px" }}
            />
          )}
          <h1 className="add-member-title">Добави нов състезател</h1>
          <div className="add-member-title-line" />
        </div>

        {/* Back button */}
        <Link href={returnUrl} className="add-member-back-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Назад към състезатели
        </Link>

        {/* Form card */}
        <div className="add-member-card">
          <form onSubmit={handleCreateMember} className="add-member-form">

            <div className="add-member-field">
              <label className="add-member-label">Име и фамилия</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="add-member-input"
                placeholder="Въведете пълно име"
              />
            </div>

            <div className="add-member-divider" />

            <div className="add-member-row">
              <div className="add-member-field">
                <label className="add-member-label">Дата на раждане</label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="add-member-input"
                />
              </div>
              <div className="add-member-field">
                <label className="add-member-label">Статус</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "paid" | "warning" | "overdue")}
                  className="add-member-select"
                >
                  <option value="paid">Платено</option>
                  <option value="warning">Напомняне</option>
                  <option value="overdue">Просрочено</option>
                </select>
              </div>
            </div>

            <div className="add-member-row">
              <div className="add-member-field">
                <label className="add-member-label">Телефон на родител</label>
                <input
                  type="tel"
                  value={parentPhone}
                  onChange={(e) => setParentPhone(e.target.value)}
                  className="add-member-input"
                  placeholder="+359..."
                />
              </div>
              <div className="add-member-field">
                <label className="add-member-label">Телефон на състезател</label>
                <input
                  type="tel"
                  value={playerPhone}
                  onChange={(e) => setPlayerPhone(e.target.value)}
                  className="add-member-input"
                  placeholder="По желание"
                />
              </div>
            </div>

            <div className="add-member-row">
              {clubData?.paymentWorkflow !== "rolling_30_days" && (
              <div className="add-member-field">
                <label className="add-member-label">
                  Начален месец на таксуване
                </label>
                <input
                  type="month"
                  value={firstBillingMonth}
                  onChange={(e) => setFirstBillingMonth(e.target.value)}
                  className="add-member-input"
                  placeholder={clubData?.billingStatus !== "active" ? "НЕ Е ЗАДЪЛЖИТЕЛНО" : undefined}
                />
              </div>
              )}
              <PlayerExtraFields settings={clubData} values={{ rank, weight }} variant="add" onChange={(field, value) => field === "rank" ? setRank(value) : setWeight(value)} />
              {playerFieldEnabled(clubData, "teamGroup") && <label className="add-member-field">
                <span className="add-member-label">Набор</span>
                <input className="add-member-input" inputMode="numeric" value={teamGroup ?? birthDate.slice(0, 4)} onChange={event => setTeamGroup(event.target.value.replace(/\D/g, ""))} />
              </label>}
              {playerFieldEnabled(clubData, "jerseyNumber") && (<div className="add-member-field">
                <label className="add-member-label">Номер в отбора</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={jerseyNumber}
                  onChange={(e) => setJerseyNumber(e.target.value.replace(/\D/g, ""))}
                  className="add-member-input"
                  placeholder="НЕ Е ЗАДЪЛЖИТЕЛНО"
                />
              </div>)}
            </div>

            {customGroups.length > 0 && (
              <div className="amp-info-cell amp-info-cell--full amp-info-cell--dropdown">
                <button
                  type="button"
                  className="amp-info-cell-trigger"
                  onClick={() => setCustomGroupDropdownOpen((v) => !v)}
                >
                  <div className="amp-info-cell-trigger-text">
                    <p className="amp-lbl">Групи</p>
                    <p className="amp-val">
                      {selectedCustomGroupIds.size === 0
                        ? "Без група"
                        : selectedCustomGroupIds.size === 1
                          ? customGroups.find((g) => selectedCustomGroupIds.has(g.id))?.name
                          : `${selectedCustomGroupIds.size} групи избрани`}
                    </p>
                  </div>
                  <span className={`amp-acc-chevron${customGroupDropdownOpen ? " open" : ""}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </button>
                <div className={`amp-acc-body${customGroupDropdownOpen ? " open" : ""}`}>
                  <div className="amp-acc-inner">
                    <div className="amp-coach-group-picker">
                      <div className="amp-coach-group-picker-list">
                        {customGroups.map((g) => {
                          const checked = selectedCustomGroupIds.has(g.id);
                          return (
                            <label
                              key={g.id}
                              className={`amp-coach-group-option${checked ? " is-selected" : ""}`}
                            >
                              <input
                                type="checkbox"
                                className="amp-group-check-input"
                                checked={checked}
                                onChange={(e) => {
                                  setSelectedCustomGroupIds((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(g.id);
                                    else next.delete(g.id);
                                    return next;
                                  });
                                }}
                              />
                              <span className="amp-group-check-box" aria-hidden="true" />
                              <span className="amp-coach-group-option-name">{g.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="add-member-field">
              <label className="add-member-label">Снимка на състезател</label>
              <label className={`add-member-dropzone${avatarPreviewUrl ? " add-member-dropzone--has-image" : ""}`}>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (file) {
                      const err = validateImageFile(file);
                      if (err) { setError(err); e.target.value = ""; return; }
                    }
                    setAvatarFile(file);
                  }}
                />
                {avatarPreviewUrl ? (
                  <img
                    src={avatarPreviewUrl}
                    alt="Preview"
                    className="add-member-dropzone-preview"
                  />
                ) : (
                  <div className="add-member-dropzone-placeholder">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                    <span>Кликнете за да изберете снимка</span>
                    <span className="add-member-dropzone-sub">JPG, PNG, WEBP</span>
                  </div>
                )}
                {avatarPreviewUrl && (
                  <div className="add-member-dropzone-overlay">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span>Смени снимката</span>
                  </div>
                )}
              </label>
            </div>

            {error && (
              <div className="add-member-error">{error}</div>
            )}

            <div className="add-member-actions">
              <button
                type="button"
                onClick={() => router.push(returnUrl)}
                className="add-member-btn-cancel"
              >
                Отказ
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="add-member-btn-submit"
              >
                {isSubmitting ? "Създаване..." : "Създай състезател"}
              </button>
            </div>

          </form>
        </div>
      </div>

      {duplicateWarning && (
        <div
          className="add-member-modal-overlay"
          onClick={() => !isSubmitting && setDuplicateWarning(null)}
        >
          <div className="add-member-modal" onClick={(e) => e.stopPropagation()}>
            <div className="add-member-modal-icon">!</div>
            <h2 className="add-member-modal-title">Възможно дублиране на състезател</h2>
            <p className="add-member-modal-text">
              Вече има активен състезател със същото име и дата на раждане:
            </p>
            <div className="add-member-modal-player">
              <strong>{duplicateWarning.fullName}</strong>
              <span>{normalizeDateInput(duplicateWarning.birthDate) || birthDate}</span>
            </div>
            <p className="add-member-modal-subtext">
              Сигурни ли сте, че искате да добавите състезателя отново?
            </p>
            <div className="add-member-modal-actions">
              <button
                type="button"
                className="add-member-btn-cancel"
                onClick={() => setDuplicateWarning(null)}
                disabled={isSubmitting}
              >
                Отказ
              </button>
              <button
                type="button"
                className="add-member-btn-submit"
                onClick={handleConfirmDuplicateCreate}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Създаване..." : "Добави отново"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AddMemberPage() {
  return (
    <Suspense
      fallback={
        <div className="add-member-page">
          <div className="add-member-dot-grid" />
          <div className="add-member-inner" style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
            <p className="add-member-hint">Зареждане...</p>
          </div>
        </div>
      }
    >
      <AddMemberPageContent />
    </Suspense>
  );
}
