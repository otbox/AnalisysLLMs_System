// components/NemotronPanel.tsx
import React, { useState, useCallback } from "react";

interface Props {
  apiBase: string;
}

interface NemotronResponse {
  sessionId?: string;
  detections: unknown;
  rawResponse: unknown;
}

type ActiveTab = "detections" | "raw";

// File System Access API (Chrome/Edge). Typed loosely because it is not in lib.dom yet.
type DirectoryHandle = {
  name: string;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
  }>;
};

export function NemotronPanel({ apiBase }: Props) {
  // Inputs
  const [imageBase64, setImageBase64] = useState("");
  const [fileName,    setFileName]    = useState("");
  const [previewUrl,  setPreviewUrl]  = useState("");

  // Download folder (File System Access API)
  const [dirHandle, setDirHandle] = useState<DirectoryHandle | null>(null);

  // State
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [result,    setResult]    = useState<NemotronResponse | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("detections");
  const [savedTo,   setSavedTo]   = useState("");

  // ── Image file ────────────────────────────────────────────────────────────

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name.replace(/\.[^/.]+$/, ""));
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      setImageBase64(dataUri.split(",")[1] ?? "");
      setPreviewUrl(dataUri);
      setResult(null);
      setError("");
      setSavedTo("");
    };
    reader.readAsDataURL(file);
  };

  // ── Download folder picker ────────────────────────────────────────────────

  const supportsDirectoryPicker = "showDirectoryPicker" in window;

  const handlePickFolder = async () => {
    try {
      const handle = await (window as unknown as {
        showDirectoryPicker: () => Promise<DirectoryHandle>;
      }).showDirectoryPicker();
      setDirHandle(handle);
    } catch {
      /* user cancelled the picker */
    }
  };

  // ── JSON download / save ──────────────────────────────────────────────────

  const saveJson = useCallback(async (data: unknown) => {
    const json = JSON.stringify(data, null, 2);
    const name = `${fileName || "nemotron-result"}.json`;

    if (dirHandle) {
      const fileHandle = await dirHandle.getFileHandle(name, { create: true });
      const writable   = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      setSavedTo(`${dirHandle.name}/${name}`);
      return;
    }

    // Fallback: regular browser download (goes to the default Downloads folder)
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setSavedTo(name);
  }, [dirHandle, fileName]);

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!imageBase64) return setError("Select an image.");

    setLoading(true);
    setError("");
    setResult(null);
    setSavedTo("");

    try {
      const res = await fetch(`${apiBase}/analisysNvidia`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ imageBase64 }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string })?.message ?? `HTTP ${res.status}`,
        );
      }

      const data: NemotronResponse = await res.json();
      setResult(data);
      setActiveTab("detections");

      // Auto-save the detections JSON named after the uploaded image
      await saveJson(data.detections);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, imageBase64, saveJson]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="layout">

      {/* ── Sidebar ── */}
      <aside className="config-panel">

        {/* Image */}
        <div className="panel-section">
          <div className="section-header">
            <h2 className="section-title">🖼️ Image</h2>
          </div>
          <div className="input-group">
            <label className="input-label">File</label>
            <input
              type="file"
              accept="image/*"
              className="input-field"
              onChange={handleImageChange}
            />
            {fileName && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                JSON will be saved as <code>{fileName}.json</code>
              </span>
            )}
          </div>
          {previewUrl && <img src={previewUrl} alt="preview" className="image-preview" />}
        </div>

        {/* Download destination */}
        <div className="panel-section">
          <div className="section-header">
            <h2 className="section-title">📂 Download folder</h2>
          </div>
          {supportsDirectoryPicker ? (
            <>
              <button className="btn-secondary" onClick={handlePickFolder}>
                {dirHandle ? `📁 ${dirHandle.name}` : "Choose folder…"}
              </button>
              <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                {dirHandle
                  ? "The JSON will be written directly into this folder."
                  : "If no folder is chosen, the JSON goes to the default Downloads folder."}
              </span>
            </>
          ) : (
            <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
              This browser does not support folder selection; the JSON will be
              saved to the default Downloads folder.
            </span>
          )}
        </div>

        {/* Submit */}
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={loading || !imageBase64}
        >
          {loading ? "⏳ Analyzing..." : "🟩 Run Nemotron"}
        </button>

        {result && (
          <button className="btn-secondary" onClick={() => saveJson(result.detections)}>
            ⬇️ Download JSON again
          </button>
        )}

      </aside>

      {/* ── Main ── */}
      <main className="results-panel">

        <div className="main-tabs">
          <button
            className={`main-tab ${activeTab === "detections" ? "active" : ""}`}
            onClick={() => setActiveTab("detections")}
          >
            📋 Detections
          </button>
          <button
            className={`main-tab ${activeTab === "raw" ? "active" : ""}`}
            onClick={() => setActiveTab("raw")}
          >
            🧾 Raw response
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: "var(--spacing-lg)" }}>
            <div className="alert danger">{error}</div>
          </div>
        )}

        {/* Saved confirmation */}
        {savedTo && !error && (
          <div style={{ padding: "var(--spacing-md) var(--spacing-lg) 0" }}>
            <div className="alert" style={{ backgroundColor: "var(--success-light)", color: "var(--success)", border: "1px solid var(--success)" }}>
              ✅ JSON saved: <strong>{savedTo}</strong>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="loading-state">
            <div className="spinner" />
            <p>Running nemoretriever-page-elements-v3 on NVIDIA...</p>
          </div>
        )}

        {/* Result */}
        {!loading && result && (
          <div className="results-content">
            <pre className="job-json-body" style={{ maxHeight: "none" }}>
              {JSON.stringify(
                activeTab === "detections" ? result.detections : result.rawResponse,
                null,
                2,
              )}
            </pre>
          </div>
        )}

        {/* Empty state */}
        {!loading && !result && (
          <div className="empty-state">
            <span className="empty-icon">🟩</span>
            <h3>Nemotron Page Elements</h3>
            <p>
              Select an image and click <strong>Run Nemotron</strong> to detect
              page elements. The resulting JSON is automatically saved with the
              same name as the image.
            </p>
          </div>
        )}

      </main>
    </div>
  );
}
