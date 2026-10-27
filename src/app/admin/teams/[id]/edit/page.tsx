"use client";

import PlayerFieldSettings from "@/components/PlayerFieldSettings";
import { type PlayerField } from "@/lib/playerFields";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { extractUploadPathFromCloudinaryUrl } from "@/lib/cloudinaryImagePath";
import { uploadImage } from "@/lib/uploadImage";
import "../../add/page.css";

interface TeamForm {
  name: string;
  sports: string;
}

interface TeamPayload {
  playerFields: PlayerField[];
  id: string;
  name: string;
  sports: string | null;
  imageUrl: string | null;
  imagePath: string | null;
  imagePublicId: string | null;
}

export default function AdminEditTeamPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const teamId = typeof params.id === "string" ? params.id : "";

  const [formData, setFormData] = useState<TeamForm>({ name: "", sports: "" });
  const [playerFields, setPlayerFields] = useState<PlayerField[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [existingImagePath, setExistingImagePath] = useState<string | null>(null);
  const [existingImagePublicId, setExistingImagePublicId] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!teamId) return;

    const fetchTeam = async () => {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const response = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          if (response.status === 404) {
            router.replace("/admin/players");
            return;
          }
          throw new Error("Неуспешно зареждане на отбора");
        }

        const data = (await response.json()) as TeamPayload;
        setPlayerFields(data.playerFields);
        setFormData({ name: data.name ?? "", sports: data.sports ?? "" });
        setPreviewUrl(data.imageUrl ?? null);
        setExistingImagePath(data.imagePath ?? null);
        setExistingImagePublicId(data.imagePublicId ?? null);
      } catch (error) {
        console.error("Team fetch error:", error);
        setErrorMessage(error instanceof Error ? error.message : "Възникна грешка");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchTeam();
  }, [router, teamId]);

  useEffect(() => {
    if (!imageFile) {
      return;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [imageFile]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setFormData((prev) => ({ ...prev, name }));
  };

  const handleImageSelect = (file: File | null) => {
    setImageFile(file);
    if (file) {
      setRemoveImage(false);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setPreviewUrl(null);
    setExistingImagePath(null);
    setExistingImagePublicId(null);
    setRemoveImage(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      setErrorMessage("Името на отбора е задължително");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      let resolvedImageUrl: string | null = existingImagePath;
      let resolvedImagePublicId: string | null = existingImagePublicId;

      if (imageFile) {
        const uploaded = await uploadImage(imageFile, "club", trimmedName || imageFile.name);
        resolvedImageUrl = extractUploadPathFromCloudinaryUrl(uploaded.secure_url);
        resolvedImagePublicId = uploaded.public_id;
      } else if (removeImage) {
        resolvedImageUrl = null;
        resolvedImagePublicId = null;
      }

      const response = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          sports: formData.sports.trim(),
          playerFields,
          imageUrl: resolvedImageUrl,
          imagePublicId: resolvedImagePublicId,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          typeof data?.error === "string" ? data.error : "Грешка при редактиране на отбор",
        );
      }

      router.push(`/admin/members?clubId=${encodeURIComponent(teamId)}`);
    } catch (error) {
      console.error("Edit team error:", error);
      setErrorMessage(error instanceof Error ? error.message : "Възникна грешка");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <main className="add-team-page">
        <div className="add-team-container">
          <p className="add-team-subtitle">Зареждане...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="add-team-page">
      <div className="add-team-container">
        <div className="add-team-header">
          <h1 className="add-team-title">Редакция на отбор</h1>
          <div className="add-team-title-line" />
          <p className="add-team-subtitle">Променете данните на отбора</p>
          <button
            className="back-btn"
            onClick={() => router.push(`/admin/members?clubId=${encodeURIComponent(teamId)}`)}
          >
            ← Назад към състезатели
          </button>
        </div>

        <form onSubmit={handleSubmit} className="add-team-form">
          {errorMessage && <div className="error-message">{errorMessage}</div>}

          <div className="form-group">
            <label htmlFor="name" className="form-label">
              Име на отбора *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleNameChange}
              className="form-input"
              placeholder="Въведете име на отбора"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="sports" className="form-label">
              Спорт
            </label>
            <input
              type="text"
              id="sports"
              name="sports"
              value={formData.sports}
              onChange={(e) => setFormData((prev) => ({ ...prev, sports: e.target.value }))}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="image" className="form-label">
              Емблема на отбора
            </label>
            <div className="image-upload">
              {previewUrl ? (
                <div className="image-preview">
                  <img src={previewUrl} alt="Емблема" className="preview-image" />
                  <button type="button" className="remove-image-btn" onClick={handleRemoveImage}>
                    Премахни
                  </button>
                </div>
              ) : (
                <div className="upload-area" onClick={() => document.getElementById("image")?.click()}>
                  <input
                    type="file"
                    id="image"
                    accept="image/*"
                    onChange={(e) => handleImageSelect(e.target.files?.[0] ?? null)}
                    className="file-input"
                  />
                  <div className="upload-placeholder">
                    <div className="upload-icon">📷</div>
                    <p>Качване на емблема</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <PlayerFieldSettings value={playerFields} onChange={setPlayerFields} disabled={isSubmitting} />

          <div className="form-actions">
            <button type="submit" className="submit-btn" disabled={isSubmitting}>
              {isSubmitting ? "Записване..." : "Запази промените"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
