// components/AnnotationPanel.tsx
import React, { useState, useCallback } from "react";
import type { UiElement } from "../types";

interface AnnotationResult {
  mimeType: string;
  width: number;
  height: number;
  elementsCount: number;
  dataUri: string;
}

interface Props {
  apiBase: string;
}

type CoordScale = "pixels" | "normalized-1000";
type ActiveTab = "result" | "json";

/** Garante que o JSON parseado vire o shape { elements: UiElement[] } aceito pelo backend */
// function normalizeAnalysis(raw: unknown): { elements: UiElement[] } {
//   if (Array.isArray(raw)) return { elements: raw as UiElement[] };
//   if (raw && typeof raw === "object") {
//     const obj = raw as Record<string, unknown>;
//     if (Array.isArray(obj.elements)) return { elements: obj.elements as UiElement[] };
//     if (Array.isArray(obj.ui))       return { elements: obj.ui as UiElement[] };
//   }
//   throw new Error("O JSON deve ser um array de elementos ou um objeto com campo 'elements' ou 'ui'.");
// }

function formatJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); }
  catch { return text; }
}

export function AnnotationPanel({ apiBase }: Props) {
  const [imageBase64, setImageBase64]   = useState("");
  const [previewUrl,  setPreviewUrl]    = useState("");
  const [jsonInput,   setJsonInput]     = useState("");
  const [coordScale,  setCoordScale]    = useState<CoordScale>("pixels");
  const [includeLabel, setIncludeLabel] = useState(true);
  const [stroke,      setStroke]        = useState("#3b82f6");
  const [fillOpacity, setFillOpacity]   = useState(15); // 0-100

  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [result,   setResult]   = useState<AnnotationResult | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("result");

  // ── imagem ────────────────────────────────────────────────────────────────

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

  // ── submit ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!imageBase64) return setError("Selecione uma imagem.");
    if (!jsonInput.trim()) return setError("Cole o JSON de elementos.");

    let analysis: { elements: UiElement[] };
    try {
    //   analysis = normalizeAnalysis(JSON.parse(jsonInput));
      analysis = JSON.parse(jsonInput);
    } catch (err) {
      return setError(err instanceof Error ? err.message : "JSON inválido.");
    }

    // if (analysis.elements.length === 0)
    //   return setError("Nenhum elemento encontrado no JSON.");

    setLoading(true);
    setError("");
    setResult(null);

    // Converte fillOpacity (0-100) para hex de opacidade no fill
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
          fill:   fillColor,
          outputFormat: "png",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any)?.message ?? `HTTP ${res.status}`);
      }

      const data: AnnotationResult = await res.json();
      setResult(data);
      setActiveTab("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }, [imageBase64, jsonInput, coordScale, includeLabel, stroke, fillOpacity, apiBase]);

  // ── download ──────────────────────────────────────────────────────────────

  const handleDownload = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href     = result.dataUri;
    a.download = "annotated.png";
    a.click();
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="layout">

      {/* ── Sidebar ── */}
      <aside className="config-panel">

        {/* Imagem */}
        <div className="panel-section">
          <div className="section-header">
            <h2 className="section-title">🖼️ Imagem</h2>
          </div>
          <div className="input-group">
            <label className="input-label">Arquivo</label>
            <input
              type="file"
              accept="image/*"
              className="input-field"
              onChange={handleImageChange}
            />
          </div>
          <div className="input-group">
            <label className="input-label">Escala de coordenadas</label>
            <select
              className="input-field"
              value={coordScale}
              onChange={(e) => setCoordScale(e.target.value as CoordScale)}
            >
              <option value="pixels">pixels</option>
              <option value="normalized-1000">normalized-1000 (0–1000)</option>
            </select>
          </div>
        </div>

        {/* JSON */}
        <div className="panel-section">
          <div className="section-header">
            <h2 className="section-title">📋 JSON de elementos</h2>
          </div>
          <div className="input-group">
            <label className="input-label">
              Array de <code>UiElement[]</code> ou objeto com campo <code>elements</code> / <code>ui</code>
            </label>
            <textarea
              className="textarea-field"
              rows={10}
              placeholder={`[\n  {\n    "id": "btn_save",\n    "type": "button",\n    "text": "Salvar",\n    "coordenadas": [120, 80, 90, 32]\n  }\n]`}
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
              ✨ Formatar
            </button>
            <button
              className="btn-secondary"
              style={{ fontSize: "0.78rem", flex: 1 }}
              onClick={() => { setJsonInput(""); setError(""); }}
            >
              🗑️ Limpar
            </button>
          </div>
        </div>

        {/* Opções visuais */}
        <div className="panel-section">
          <div className="section-header">
            <h2 className="section-title">🎨 Visual</h2>
          </div>

          <div className="input-group">
            <label className="input-label">Cor do stroke</label>
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
            <label className="input-label">Opacidade do fill: {fillOpacity}%</label>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
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
            Incluir labels nas anotações
          </label>
        </div>

        {/* Botão */}
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={loading || !imageBase64 || !jsonInput.trim()}
        >
          {loading ? "⏳ Gerando..." : "🖊️ Gerar anotação"}
        </button>

      </aside>

      {/* ── Main ── */}
      <main className="results-panel">

        {/* Tabs de resultado */}
        <div className="main-tabs">
          <button
            className={`main-tab ${activeTab === "result" ? "active" : ""}`}
            onClick={() => setActiveTab("result")}
          >
            🗺️ Imagem anotada
          </button>
          <button
            className={`main-tab ${activeTab === "json" ? "active" : ""}`}
            onClick={() => setActiveTab("json")}
          >
            📋 JSON enviado
          </button>

          {result && (
            <div style={{ marginLeft: "auto", display: "flex", gap: "var(--spacing-xs)", alignItems: "center" }}>
              <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>
                {result.elementsCount} elemento(s) · {result.width}×{result.height}px
              </span>
              <button
                className="btn-secondary"
                style={{ fontSize: "0.78rem", padding: "0.25rem 0.7rem" }}
                onClick={handleDownload}
              >
                ⬇️ Baixar PNG
              </button>
            </div>
          )}
        </div>

        {/* Preview da imagem original (antes do request) */}
        {previewUrl && !result && (
          <div style={{ padding: "0 var(--spacing-lg)" }}>
            <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "var(--spacing-xs)" }}>
              Pré-visualização da imagem original
            </p>
            <img src={previewUrl} alt="preview" className="image-preview" />
          </div>
        )}

        {/* Erro */}
        {error && (
          <div style={{ padding: "0 var(--spacing-lg)" }}>
            <div className="alert danger">{error}</div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="loading-state">
            <div className="spinner" />
            <p>Gerando imagem anotada no servidor...</p>
          </div>
        )}

        {/* Resultado */}
        {!loading && result && (
          <div className="results-content">

            {activeTab === "result" && (
              <div style={{ padding: "0 var(--spacing-lg)" }}>
                <img
                  src={result.dataUri}
                  alt="imagem anotada"
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

        {/* Estado vazio */}
        {!loading && !result && !previewUrl && (
          <div className="empty-state">
            <span className="empty-icon">🖊️</span>
            <h3>Anotação manual</h3>
            <p>Selecione uma imagem e cole o JSON de elementos para gerar uma visualização anotada pelo servidor.</p>
          </div>
        )}

      </main>
    </div>
  );
}