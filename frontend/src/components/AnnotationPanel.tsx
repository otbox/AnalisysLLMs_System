// components/AnnotationPanel.tsx
import React, { useState, useCallback } from "react";
import { FileDropZone } from "./FileDropZone";


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
  adjustedUi?: unknown[];
  adjustedEstrutura?: { ui_structure: unknown[] } | null;
  adjustedJson?: unknown;
}

interface Props {
  apiBase: string;
}

type CoordScale  = "pixels" | "normalized-1000";
type ResultVariant = "scaled" | "pixels";
type ActiveTab   = "result" | "json" | "adjusted";

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

  const [imageFileName, setImageFileName] = useState("");
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [remapCoords, setRemapCoords] = useState(true);
  const [sourceWidth, setSourceWidth] = useState("1920");
  const [sourceHeight, setSourceHeight] = useState("");
  const [offsetX, setOffsetX] = useState("0");
  const [offsetY, setOffsetY] = useState("0");

  // ── Image file ────────────────────────────────────────────────────────────

  const handleImageFile = useCallback((file: File) => {
    setImageFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      setImageBase64(dataUri.split(",")[1]);
      setPreviewUrl(dataUri);
      setResult(null);
      setError("");

      const probe = new Image();
      probe.onload = () => {
        setImageSize({ w: probe.naturalWidth, h: probe.naturalHeight });
        // Se altura do JSON ainda não foi preenchida, estima pela proporção da imagem
        setSourceHeight((prev) => {
          if (prev.trim()) return prev;
          const srcW = Number(sourceWidth) || 1920;
          return String(Math.round(srcW * (probe.naturalHeight / probe.naturalWidth)));
        });
      };
      probe.src = dataUri;
    };
    reader.readAsDataURL(file);
  }, [sourceWidth]);

  // ── JSON file ─────────────────────────────────────────────────────────────

  const handleJsonFile = useCallback((file: File) => {
    setJsonFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setJsonInput(reader.result as string);
      setError("");
    };
    reader.readAsText(file);
  }, []);

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

    const parsedSourceW = Number(sourceWidth);
    const parsedSourceH = Number(
      sourceHeight.trim()
        ? sourceHeight
        : (imageSize && Number(sourceWidth) > 0
            ? Math.round(Number(sourceWidth) * (imageSize.h / imageSize.w))
            : NaN),
    );
    const shouldRemap =
      remapCoords &&
      coordScale === "pixels" &&
      Number.isFinite(parsedSourceW) &&
      parsedSourceW > 0 &&
      Number.isFinite(parsedSourceH) &&
      parsedSourceH > 0;

    const parsedOffsetX = Number(offsetX) || 0;
    const parsedOffsetY = Number(offsetY) || 0;

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
          offsetX: parsedOffsetX,
          offsetY: parsedOffsetY,
          ...(shouldRemap
            ? { sourceWidth: parsedSourceW, sourceHeight: parsedSourceH }
            : {}),
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
  }, [
    imageBase64, jsonInput, coordScale, includeLabel, stroke, fillOpacity, apiBase,
    remapCoords, sourceWidth, sourceHeight, imageSize, offsetX, offsetY,
  ]);

  // ── Download ──────────────────────────────────────────────────────────────

  const handleDownload = (variant: ResultVariant) => {
    if (!result) return;
    const src = variant === "pixels" ? result.pixels.dataUri : result.scaled.dataUri;
    const a   = document.createElement("a");
    a.href     = src;
    a.download = `annotated_${variant}.png`;
    a.click();
  };

  const adjustedJsonText = (() => {
    if (!result) return "";
    if (result.adjustedJson) return JSON.stringify(result.adjustedJson, null, 2);
    if (result.adjustedEstrutura) return JSON.stringify(result.adjustedEstrutura, null, 2);
    if (result.adjustedUi) return JSON.stringify({ ui: result.adjustedUi }, null, 2);
    return "";
  })();

  const adjustedCount = (() => {
    if (!result) return 0;
    if (result.adjustedEstrutura?.ui_structure) return result.adjustedEstrutura.ui_structure.length;
    const aj = result.adjustedJson as { ui_structure?: unknown[]; ui?: unknown[] } | undefined;
    if (aj?.ui_structure) return aj.ui_structure.length;
    if (aj?.ui) return aj.ui.length;
    return result.adjustedUi?.length ?? 0;
  })();

  const handleDownloadAdjustedJson = () => {
    if (!adjustedJsonText) return;
    const blob = new Blob([adjustedJsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "adjusted_ui.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApplyAdjustedToEditor = () => {
    if (!adjustedJsonText) return;
    setJsonInput(adjustedJsonText);
    setOffsetX("0");
    setOffsetY("0");
    setRemapCoords(false);
    setActiveTab("json");
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
            <label className="input-label">Arquivo de imagem</label>
            <FileDropZone
              accept="image/*"
              label="Solte a imagem aqui"
              hint="PNG, JPG, WebP… ou clique para selecionar"
              fileName={imageFileName}
              onFile={handleImageFile}
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

          {imageSize && (
            <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", margin: 0 }}>
              Imagem carregada: <strong>{imageSize.w}×{imageSize.h}px</strong>
            </p>
          )}

          {coordScale === "pixels" && (
            <div className="input-group" style={{ marginTop: "var(--spacing-sm)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", color: "var(--text-secondary)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={remapCoords}
                  onChange={(e) => setRemapCoords(e.target.checked)}
                />
                Remapear JSON → resolução da imagem
              </label>
              <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>
                Use quando o JSON foi gerado em outra resolução (ex.: 1920) e a imagem é menor (ex.: 1322).
              </span>
              {remapCoords && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-sm)" }}>
                  <div className="input-group">
                    <label className="input-label">Largura do JSON</label>
                    <input
                      className="input-field"
                      type="number"
                      min={1}
                      value={sourceWidth}
                      onChange={(e) => setSourceWidth(e.target.value)}
                      placeholder="1920"
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Altura do JSON</label>
                    <input
                      className="input-field"
                      type="number"
                      min={1}
                      value={sourceHeight}
                      onChange={(e) => setSourceHeight(e.target.value)}
                      placeholder={imageSize ? String(Math.round(1920 * (imageSize.h / imageSize.w))) : "1080"}
                    />
                  </div>
                </div>
              )}
              {remapCoords && imageSize && Number(sourceWidth) > 0 && Number(sourceHeight) > 0 && (
                <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>
                  Escala: ×{(imageSize.w / Number(sourceWidth)).toFixed(4)} (X), ×{(imageSize.h / Number(sourceHeight)).toFixed(4)} (Y)
                </span>
              )}
            </div>
          )}

          <div className="input-group" style={{ marginTop: "var(--spacing-sm)" }}>
            <label className="input-label">Ajuste fino / fatia da página</label>
            <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>
              Se a imagem é só um pedaço da página (JSON até 2400, imagem começa em Y=700),
              desligue o remap e use <strong>Origem Y = 700</strong> (equivale a Offset Y = -700).
              Negativo no offset = sobe o JSON; positivo = desce.
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-sm)" }}>
              <div className="input-group">
                <label className="input-label">Origem Y do recorte</label>
                <input
                  className="input-field"
                  type="number"
                  step={1}
                  value={String(-(Number(offsetY) || 0))}
                  onChange={(e) => {
                    const origin = Number(e.target.value) || 0;
                    setOffsetY(String(-origin));
                  }}
                  placeholder="0"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Origem X do recorte</label>
                <input
                  className="input-field"
                  type="number"
                  step={1}
                  value={String(-(Number(offsetX) || 0))}
                  onChange={(e) => {
                    const origin = Number(e.target.value) || 0;
                    setOffsetX(String(-origin));
                  }}
                  placeholder="0"
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-sm)" }}>
              <div className="input-group">
                <label className="input-label">Offset X</label>
                <input
                  className="input-field"
                  type="number"
                  step={1}
                  value={offsetX}
                  onChange={(e) => setOffsetX(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Offset Y</label>
                <input
                  className="input-field"
                  type="number"
                  step={1}
                  value={offsetY}
                  onChange={(e) => setOffsetY(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {([-20, -10, -5, 5, 10, 20] as const).map((n) => (
                <button
                  key={`ox${n}`}
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}
                  onClick={() => setOffsetX(String((Number(offsetX) || 0) + n))}
                >
                  X{n > 0 ? `+${n}` : n}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {([-20, -10, -5, 5, 10, 20] as const).map((n) => (
                <button
                  key={`oy${n}`}
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}
                  onClick={() => setOffsetY(String((Number(offsetY) || 0) + n))}
                >
                  Y{n > 0 ? `+${n}` : n}
                </button>
              ))}
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}
                onClick={() => { setOffsetX("0"); setOffsetY("0"); }}
              >
                Zerar
              </button>
            </div>
          </div>
        </div>

        {/* JSON */}
        <div className="panel-section">
          <div className="section-header">
            <h2 className="section-title">📋 Elements JSON</h2>
          </div>

          {/* Upload JSON file */}
          <div className="input-group">
            <label className="input-label">Arquivo JSON</label>
            <FileDropZone
              accept="application/json,.json"
              label="Solte o JSON aqui"
              hint="Arraste o arquivo .json ou clique para selecionar"
              fileName={jsonFileName}
              onFile={handleJsonFile}
            />
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
          <button
            className={`main-tab ${activeTab === "adjusted" ? "active" : ""}`}
            onClick={() => setActiveTab("adjusted")}
            disabled={!adjustedJsonText}
          >
            ✅ JSON ajustado
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
              {adjustedJsonText && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.78rem", padding: "0.25rem 0.7rem" }}
                  onClick={handleDownloadAdjustedJson}
                >
                  ⬇️ JSON ajustado
                </button>
              )}
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

            {activeTab === "adjusted" && adjustedJsonText && (
              <div style={{ padding: "0 var(--spacing-lg) var(--spacing-lg)" }}>
                <div style={{ display: "flex", gap: "var(--spacing-sm)", marginBottom: "var(--spacing-sm)", flexWrap: "wrap" }}>
                  <button className="btn-secondary" style={{ fontSize: "0.78rem" }} onClick={handleDownloadAdjustedJson}>
                    ⬇️ Baixar JSON ajustado
                  </button>
                  <button className="btn-secondary" style={{ fontSize: "0.78rem" }} onClick={handleApplyAdjustedToEditor}>
                    ↩️ Usar no editor (e zerar offset)
                  </button>
                </div>
                <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginBottom: "var(--spacing-xs)" }}>
                  {adjustedCount} elemento(s) preservados — coordenadas transformadas (remap + offset), sem descartar.
                  Elementos fora da imagem mantêm x/y negativos ou além do tamanho; só o PNG corta o desenho.
                </p>
                <pre className="job-json-body">
                  {adjustedJsonText}
                </pre>
              </div>
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
