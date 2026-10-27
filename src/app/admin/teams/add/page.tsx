"use client";

import PlayerFieldSettings from "@/components/PlayerFieldSettings";
import { type PlayerField } from "@/lib/playerFields";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { extractUploadPathFromCloudinaryUrl } from "@/lib/cloudinaryImagePath";
import { uploadImage, validateImageFile } from "@/lib/uploadImage";
import "./page.css";

interface TeamForm {
  name: string;
  sports: string;
}

export default function AdminAddTeamPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<TeamForm>({
    name: "",
    sports: "",
  });
  const [playerFields, setPlayerFields] = useState<PlayerField[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null);
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
    setFormData((prev) => ({
      ...prev,
      name,
    }));
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
      let resolvedImageUrl: string | null = null;
      let resolvedImagePublicId: string | null = null;

      if (imageFile) {
        const uploaded = await uploadImage(
          imageFile,
          "club",
          trimmedName || imageFile.name,
        );
        resolvedImageUrl = extractUploadPathFromCloudinaryUrl(uploaded.secure_url);
        resolvedImagePublicId = uploaded.public_id;
      }

      const response = await fetch("/api/admin/teams", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          sports: formData.sports.trim(),
          playerFields,
          imageUrl: resolvedImageUrl,
          imagePublicId: resolvedImagePublicId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Грешка при добавяне на отбор");
      }

      router.push("/admin/players");
    } catch (error) {
      console.error("Add team error:", error);
      setErrorMessage(error instanceof Error ? error.message : "Възникна грешка");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="add-team-page">
      <div className="add-team-container">
        <div className="add-team-header">
          <h1 className="add-team-title">Добавяне на отбор</h1>
          <div className="add-team-title-line" />
          <p className="add-team-subtitle">Попълнете данните за новия отбор</p>
          <button className="back-btn" onClick={() => router.push("/admin/players")}>
            ← Назад към отбори
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
                  <button
                    type="button"
                    className="remove-image-btn"
                    onClick={() => setImageFile(null)}
                  >
                    Премахни
                  </button>
                </div>
              ) : (
                <div className="upload-area" onClick={() => document.getElementById("image")?.click()}>
                  <input
                    type="file"
                    id="image"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file) {
                        const err = validateImageFile(file);
                        if (err) { setErrorMessage(err); e.target.value = ""; return; }
                      }
                      setImageFile(file);
                    }}
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
              {isSubmitting ? "Добавяне..." : "Добави отбор"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
