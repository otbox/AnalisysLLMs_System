// components/AnnotationPanel.tsx
import React, { useState, useCallback } from "react";
import type { UiElement } from "../types";

// Shape returned by the updated /annotations endpoint
interface AnnotationVariant {
  mimeType:      string;
  width:         number;
  height:        number;
  elementsCount: number;
  dataUri:       string;
}

interface AnnotationResponse {
  pixels:  AnnotationVariant;
  scaled:  AnnotationVariant;
  // backward-compat alias kept by the backend
  dataUri: string;
}

interface Props {
  apiBase: string;
}

type CoordScale  = "pixels" | "normalized-1000";
type ResultVariant = "scaled" | "pixels";
type ActiveTab   = "result" | "json";

function formatJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); }
  catch { return text; }
}

export function AnnotationPanel({ apiBase }: Props) {
  // Inputs
  const [imageBase64,  setImageBase64]  = useState("");
  const [previewUrl,   setPreviewUrl]   = useState("");
  const [jsonInput,    setJsonInput]    = useState("");
  const [jsonFileName, setJsonFileName] = useState("");
  const [coordScale,   setCoordScale]   = useState<CoordScale>("pixels");
  const [includeLabel, setIncludeLabel] = useState(true);
  const [stroke,       setStroke]       = useState("#3b82f6");
  const [fillOpacity,  setFillOpacity]  = useState(15);

  // State
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [result,   setResult]   = useState<AnnotationResponse | null>(null);
  const [activeTab,    setActiveTab]    = useState<ActiveTab>("result");
  const [resultVariant, setResultVariant] = useState<ResultVariant>("scaled");

  // ── Image file ────────────────────────────────────────────────────────────

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      setImageBase64(dataUri.split(",")[1]);
      setPreviewUrl(dataUri);
      setResult(null);
      setError("");
    };
    reader.readAsDataURL(file);
  };

  // ── JSON file ─────────────────────────────────────────────────────────────

  const handleJsonFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setJsonFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setJsonInput(reader.result as string);
      setError("");
    };
    reader.readAsText(file);
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!imageBase64)       return setError("Select an image.");
    if (!jsonInput.trim())  return setError("Provide the elements JSON.");

    let analysis: unknown;
    try {
      analysis = JSON.parse(jsonInput);
    } catch {
      return setError("Invalid JSON.");
    }

    setLoading(true);
    setError("");
    setResult(null);

    const fillAlpha = Math.round((fillOpacity / 100) * 255).toString(16).padStart(2, "0");
    const fillColor = `${stroke}${fillAlpha}`;

    try {
      const res = await fetch(`${apiBase}/annotations`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64,
          analysis,
          coordScale,
          includeLabel,
          stroke,
          fill:         fillColor,
          outputFormat: "png",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any)?.message ?? `HTTP ${res.status}`);
      }

      const data: AnnotationResponse = await res.json();
      setResult(data);
      setActiveTab("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }, [imageBase64, jsonInput, coordScale, includeLabel, stroke, fillOpacity, apiBase]);

  // ── Download ──────────────────────────────────────────────────────────────

  const handleDownload = (variant: ResultVariant) => {
    if (!result) return;
    const src = variant === "pixels" ? result.pixels.dataUri : result.scaled.dataUri;
    const a   = document.createElement("a");
    a.href     = src;
    a.download = `annotated_${variant}.png`;
    a.click();
  };

  const activeVariant = result ? (resultVariant === "pixels" ? result.pixels : result.scaled) : null;

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
          </div>
          <div className="input-group">
            <label className="input-label">Coordinate scale</label>
            <select
              className="input-field"
              value={coordScale}
              onChange={(e) => setCoordScale(e.target.value as CoordScale)}
            >
              <option value="pixels">pixels (absolute)</option>
              <option value="normalized-1000">normalized-1000 (0–1000)</option>
            </select>
          </div>
        </div>

        {/* JSON */}
        <div className="panel-section">
          <div className="section-header">
            <h2 className="section-title">📋 Elements JSON</h2>
          </div>

          {/* Upload JSON file */}
          <div className="input-group">
            <label className="input-label">Upload JSON file</label>
            <input
              type="file"
              accept="application/json,.json"
              className="input-field"
              onChange={handleJsonFileChange}
            />
            {jsonFileName && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                {jsonFileName}
              </span>
            )}
          </div>

          {/* Or paste */}
          <div className="input-group">
            <label className="input-label">
              Or paste <code>UiElement[]</code> / object with <code>ui</code> field
            </label>
            <textarea
              className="textarea-field"
              rows={8}
              placeholder={`[\n  {\n    "id": "btn_save",\n    "type": "button",\n    "text": "Save",\n    "coordenadas": [120, 80, 90, 32]\n  }\n]`}
              value={jsonInput}
              onChange={(e) => { setJsonInput(e.target.value); setError(""); }}
              style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.78rem" }}
            />
          </div>

          <div style={{ display: "flex", gap: "var(--spacing-sm)" }}>
            <button
              className="btn-secondary"
              style={{ fontSize: "0.78rem", flex: 1 }}
              onClick={() => setJsonInput(formatJson(jsonInput))}
            >
              ✨ Format
            </button>
            <button
              className="btn-secondary"
              style={{ fontSize: "0.78rem", flex: 1 }}
              onClick={() => { setJsonInput(""); setJsonFileName(""); setError(""); }}
            >
              🗑️ Clear
            </button>
          </div>
        </div>

        {/* Visual options */}
        <div className="panel-section">
          <div className="section-header">
            <h2 className="section-title">🎨 Visual</h2>
          </div>

          <div className="input-group">
            <label className="input-label">Stroke colour</label>
            <div style={{ display: "flex", gap: "var(--spacing-sm)", alignItems: "center" }}>
              <input
                type="color"
                value={stroke}
                onChange={(e) => setStroke(e.target.value)}
                style={{ width: 36, height: 36, borderRadius: 6, border: "1px solid var(--border-color)", cursor: "pointer" }}
              />
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                {stroke}
              </span>
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Fill opacity: {fillOpacity}%</label>
            <input
              type="range" min={0} max={60} step={1}
              value={fillOpacity}
              onChange={(e) => setFillOpacity(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", color: "var(--text-secondary)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={includeLabel}
              onChange={(e) => setIncludeLabel(e.target.checked)}
            />
            Include labels in annotations
          </label>
        </div>

        {/* Submit */}
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={loading || !imageBase64 || !jsonInput.trim()}
        >
          {loading ? "⏳ Generating..." : "🖊️ Generate annotation"}
        </button>

      </aside>

      {/* ── Main ── */}
      <main className="results-panel">

        {/* Top bar */}
        <div className="main-tabs">
          <button
            className={`main-tab ${activeTab === "result" ? "active" : ""}`}
            onClick={() => setActiveTab("result")}
          >
            🗺️ Annotated image
          </button>
          <button
            className={`main-tab ${activeTab === "json" ? "active" : ""}`}
            onClick={() => setActiveTab("json")}
          >
            📋 JSON sent
          </button>

          {/* Variant picker + meta + download — visible only when there is a result */}
          {result && (
            <div style={{ marginLeft: "auto", display: "flex", gap: "var(--spacing-sm)", alignItems: "center", flexWrap: "wrap" }}>

              {/* pixels / scaled toggle */}
              <div style={{ display: "flex", gap: 4 }}>
                {(["scaled", "pixels"] as ResultVariant[]).map((v) => (
                  <button
                    key={v}
                    className="btn-secondary"
                    style={{
                      fontSize: "0.72rem",
                      padding: "0.2rem 0.6rem",
                      ...(resultVariant === v
                        ? { borderColor: "var(--accent-primary)", color: "var(--accent-primary)", fontWeight: 600 }
                        : {}),
                    }}
                    onClick={() => setResultVariant(v)}
                  >
                    {v === "scaled" ? "🔍 Scaled" : "📐 Pixels"}
                  </button>
                ))}
              </div>

              {activeVariant && (
                <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>
                  {activeVariant.elementsCount} element(s) · {activeVariant.width}×{activeVariant.height}px
                </span>
              )}

              <button
                className="btn-secondary"
                style={{ fontSize: "0.78rem", padding: "0.25rem 0.7rem" }}
                onClick={() => handleDownload(resultVariant)}
              >
                ⬇️ Download PNG
              </button>
            </div>
          )}
        </div>

        {/* Original image preview (before submit) */}
        {previewUrl && !result && (
          <div style={{ padding: "0 var(--spacing-lg)" }}>
            <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "var(--spacing-xs)" }}>
              Original image preview
            </p>
            <img src={previewUrl} alt="preview" className="image-preview" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: "0 var(--spacing-lg)" }}>
            <div className="alert danger">{error}</div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="loading-state">
            <div className="spinner" />
            <p>Generating annotated image on the server...</p>
          </div>
        )}

        {/* Result */}
        {!loading && result && (
          <div className="results-content">

            {activeTab === "result" && activeVariant && (
              <div style={{ padding: "0 var(--spacing-lg)" }}>
                <img
                  src={activeVariant.dataUri}
                  alt={`annotated ${resultVariant}`}
                  className="image-preview"
                  style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border-color)" }}
                />
              </div>
            )}

            {activeTab === "json" && (
              <pre className="job-json-body" style={{ margin: "var(--spacing-lg)" }}>
                {formatJson(jsonInput)}
              </pre>
            )}

          </div>
        )}

        {/* Empty state */}
        {!loading && !result && !previewUrl && (
          <div className="empty-state">
            <span className="empty-icon">🖊️</span>
            <h3>Manual Annotator</h3>
            <p>
              Select an image, upload or paste the elements JSON, then click
              <strong> Generate annotation</strong> to produce both a pixels and a
              scaled annotated image.
            </p>
          </div>
        )}

      </main>
    </div>
  );
}
