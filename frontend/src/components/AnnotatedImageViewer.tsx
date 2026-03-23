// components/AnnotatedImageViewer.tsx
import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import type { UiElement } from "../types";

export type CoordScale = "normalized-1000" | "pixels";

interface Props {
  imageBase64:  string;
  elements:     UiElement[];
  coordScale?:  CoordScale;
}

const TYPE_COLORS: Record<string, string> = {
  button:         "#3b82f6",
  icon:           "#8b5cf6",
  input:          "#10b981",
  select:         "#06b6d4",
  label:          "#f59e0b",
  link:           "#6366f1",
  image:          "#ec4899",
  tab:            "#f97316",
  "table-header": "#ef4444",
  "table-cell":   "#84cc16",
  "table-row":    "#84cc16",
  chart:          "#14b8a6",
  text:           "#94a3b8",
  badge:          "#f43f5e",
  toggle:         "#22d3ee",
};
const DEFAULT_COLOR = "#ff2d2d";

function getColor(type?: string) {
  return TYPE_COLORS[type ?? ""] ?? DEFAULT_COLOR;
}

function toBox(c: UiElement["coordenadas"]): { x: number; y: number; w: number; h: number } | null {
  if (Array.isArray(c) && c.length >= 4)
    return { x: c[0], y: c[1], w: c[2], h: c[3] };
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const o = c as { x: number; y: number; w: number; h: number };
    if ([o.x, o.y, o.w, o.h].every((n) => typeof n === "number" && isFinite(n))) return o;
  }
  return null;
}

/**
 * Converte coordenada LLM → pixels no canvas (que tem resolução natural).
 *
 * normalized-1000 → x_canvas = (x / 1000) * naturalWidth
 * pixels          → x_canvas = x  (já está em pixels naturais)
 *
 * O canvas é desenhado em resolução natural e depois escalado via CSS
 * para cobrir exatamente a imagem exibida — isso garante alinhamento
 * perfeito independente do tamanho de exibição.
 */
function toNaturalPx(
  box:    { x: number; y: number; w: number; h: number },
  scale:  CoordScale,
  natW:   number,
  natH:   number,
) {
  if (scale === "normalized-1000") {
    return {
      x: (box.x / 1000) * natW,
      y: (box.y / 1000) * natH,
      w: (box.w / 1000) * natW,
      h: (box.h / 1000) * natH,
    };
  }
  // pixels: sem conversão
  return box;
}

// ─────────────────────────────────────────────────────────────────────────────

export function AnnotatedImageViewer({
  imageBase64,
  elements,
  coordScale = "normalized-1000",
}: Props) {
  const wrapRef    = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const imgRef     = useRef<HTMLImageElement>(null);

  const [showLabels, setShowLabels] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [hovered,    setHovered]    = useState<UiElement | null>(null);
  const [selected,   setSelected]   = useState<UiElement | null>(null);

  // Dimensões naturais (resolução real da imagem)
  const [nat, setNat] = useState({ w: 0, h: 0 });

  const dataUri = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/png;base64,${imageBase64}`;

  const types = useMemo(() =>
    ["all", ...Array.from(new Set(elements.map((e) => e.type ?? "?").filter(Boolean)))],
    [elements],
  );

  const visibleElements = useMemo(() =>
    filterType === "all" ? elements : elements.filter((e) => e.type === filterType),
    [elements, filterType],
  );

  // Quando a imagem carrega, salva as dimensões NATURAIS
  const handleImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setNat({ w: img.naturalWidth, h: img.naturalHeight });
  };

  // ── redraw em resolução natural ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nat.w === 0) return;

    // Canvas tem resolução NATURAL — CSS vai escalá-lo para o tamanho exibido
    canvas.width  = nat.w;
    canvas.height = nat.h;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, nat.w, nat.h);

    // Espessura e fonte proporcional à resolução natural
    const strokeW  = Math.max(2, Math.round(Math.min(nat.w, nat.h) * 0.003));
    const fontSize = Math.max(14, Math.round(Math.min(nat.w, nat.h) * 0.018));

    visibleElements.forEach((el) => {
      const raw = toBox(el.coordenadas);
      if (!raw) return;

      const { x, y, w, h } = toNaturalPx(raw, coordScale, nat.w, nat.h);
      if (w <= 0 || h <= 0) return;

      const color    = getColor(el.type);
      const isActive = el === hovered || el === selected;

      ctx.fillStyle   = isActive ? `${color}40` : `${color}1a`;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth   = isActive ? strokeW * 2 : strokeW;
      ctx.strokeRect(x, y, w, h);

      if (showLabels && el.id) {
        const label  = `${el.type ?? "?"} · ${el.id}`;
        ctx.font         = `bold ${fontSize}px monospace`;
        ctx.textBaseline = "top";
        const tw = ctx.measureText(label).width + 8;
        const th = fontSize + 6;
        const ly = y - th - 2 > 0 ? y - th - 2 : y + 2;
        ctx.fillStyle = color;
        ctx.fillRect(x, ly, tw, th);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x + 4, ly + 3);
      }
    });
  }, [visibleElements, nat, showLabels, hovered, selected, coordScale]);

  // ── hit-test usa as mesmas coordenadas naturais ──────────────────────────
  const hitTest = useCallback(
    (clientX: number, clientY: number): UiElement | null => {
      const canvas = canvasRef.current;
      if (!canvas || nat.w === 0) return null;

      // getBoundingClientRect → tamanho exibido no CSS
      const rect    = canvas.getBoundingClientRect();
      const scaleX  = nat.w / rect.width;
      const scaleY  = nat.h / rect.height;

      // Converte posição do mouse para coordenadas naturais do canvas
      const mx = (clientX - rect.left)  * scaleX;
      const my = (clientY - rect.top)   * scaleY;

      for (let i = visibleElements.length - 1; i >= 0; i--) {
        const raw = toBox(visibleElements[i].coordenadas);
        if (!raw) continue;
        const { x, y, w, h } = toNaturalPx(raw, coordScale, nat.w, nat.h);
        if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
          return visibleElements[i];
        }
      }
      return null;
    },
    [visibleElements, nat, coordScale],
  );

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setHovered(hitTest(e.clientX, e.clientY));
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setSelected(hitTest(e.clientX, e.clientY));
  };

  const activeEl = selected ?? hovered;

  function coordsLabel(el: UiElement): string {
    const raw = toBox(el.coordenadas);
    if (!raw) return "—";
    const suffix = coordScale === "normalized-1000" ? " (0-1000)" : " (px)";
    return `${raw.x}, ${raw.y}, ${raw.w}, ${raw.h}${suffix}`;
  }

  return (
    <div className="annotation-viewer">

      {/* Toolbar */}
      <div className="annotation-toolbar">
        <div style={{ display: "flex", gap: "var(--spacing-sm)", alignItems: "center", flexWrap: "wrap" }}>
          <label className="input-label" style={{ margin: 0 }}>Filtrar tipo:</label>
          <select
            className="input-field"
            style={{ width: "auto", padding: "0.2rem 0.5rem", fontSize: "0.78rem" }}
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "Todos" : t}
                {t !== "all" && ` (${elements.filter((el) => el.type === t).length})`}
              </option>
            ))}
          </select>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
            Mostrar labels
          </label>

          <span style={{
            marginLeft: "auto", fontSize: "0.7rem", padding: "0.15rem 0.55rem",
            borderRadius: "999px", border: "1px solid var(--accent-primary)",
            color: "var(--accent-primary)", fontFamily: "monospace",
          }}>
            escala: {coordScale === "normalized-1000" ? "0–1000" : "pixels"}
          </span>

          <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
            {visibleElements.length} visível(is)
            {nat.w > 0 && ` · ${nat.w}×${nat.h}px`}
          </span>
        </div>
      </div>

      {/* Legenda */}
      <div className="annotation-legend">
        {Object.entries(TYPE_COLORS).map(([t, c]) => (
          <span
            key={t}
            className="legend-chip"
            style={{ borderColor: c, color: c, cursor: "pointer", opacity: filterType !== "all" && filterType !== t ? 0.35 : 1 }}
            onClick={() => setFilterType(filterType === t ? "all" : t)}
          >
            <span className="legend-dot" style={{ background: c }} />{t}
          </span>
        ))}
      </div>

      {/* Imagem + Canvas sobrepostos */}
      <div
        ref={wrapRef}
        className="annotation-canvas-wrap"
        style={{ position: "relative", display: "inline-block", width: "100%" }}
      >
        <img
          ref={imgRef}
          src={dataUri}
          alt="screenshot"
          className="annotation-img"
          onLoad={handleImgLoad}
          draggable={false}
          style={{ display: "block", width: "100%", height: "auto" }}
        />
        {/* Canvas tem resolução natural mas é escalado via CSS para cobrir a imagem */}
        <canvas
          ref={canvasRef}
          className="annotation-canvas"
          style={{
            position:  "absolute",
            top:       0,
            left:      0,
            width:     "100%",   // ← CSS escala para cobrir a imagem
            height:    "100%",
            cursor:    "crosshair",
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
          onClick={handleClick}
          title={activeEl?.id ?? ""}
        />
      </div>

      {/* Detalhe do elemento ativo */}
      {activeEl && (
        <div className="annotation-tooltip">
          <div className="annotation-tooltip-header">
            <span
              className="job-status-badge success"
              style={{ background: `${getColor(activeEl.type)}22`, color: getColor(activeEl.type), borderColor: getColor(activeEl.type) }}
            >
              {activeEl.type}
            </span>
            <span className="job-model-name">{activeEl.id}</span>
            {selected && (
              <button
                className="btn-secondary"
                style={{ marginLeft: "auto", fontSize: "0.7rem", padding: "0.1rem 0.45rem" }}
                onClick={() => setSelected(null)}
              >
                ✕ desselecionar
              </button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--spacing-xs)", padding: "var(--spacing-sm)" }}>
            {activeEl.text && (
              <div className="meta-card" style={{ padding: "0.4rem 0.6rem" }}>
                <span className="meta-label">text</span>
                <span className="meta-value" style={{ fontSize: "0.8rem" }}>{activeEl.text}</span>
              </div>
            )}
            {activeEl.region && (
              <div className="meta-card" style={{ padding: "0.4rem 0.6rem" }}>
                <span className="meta-label">region</span>
                <span className="meta-value" style={{ fontSize: "0.8rem" }}>{activeEl.region}</span>
              </div>
            )}
            {activeEl.state && (
              <div className="meta-card" style={{ padding: "0.4rem 0.6rem" }}>
                <span className="meta-label">state</span>
                <span className="meta-value" style={{ fontSize: "0.8rem" }}>{activeEl.state}</span>
              </div>
            )}
            {activeEl.actions && activeEl.actions.length > 0 && (
              <div className="meta-card" style={{ padding: "0.4rem 0.6rem" }}>
                <span className="meta-label">actions</span>
                <span className="meta-value" style={{ fontSize: "0.8rem" }}>{activeEl.actions.join(", ")}</span>
              </div>
            )}
            <div className="meta-card" style={{ padding: "0.4rem 0.6rem" }}>
              <span className="meta-label">coordenadas</span>
              <span className="meta-value" style={{ fontSize: "0.75rem", fontFamily: "monospace" }}>
                {coordsLabel(activeEl)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
