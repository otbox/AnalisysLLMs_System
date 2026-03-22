// components/AnnotatedImageViewer.tsx
import React, { useRef, useEffect, useState, useMemo } from "react";
import type { UiElement } from "../types";

/** Escala de coordenadas vinda do LLM */
export type CoordScale = "normalized-1000" | "pixels";

interface Props {
  imageBase64: string;
  elements:    UiElement[];
  /** Padrão: "normalized-1000" — alinhado ao prompt atual */
  coordScale?: CoordScale;
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

function getColor(type?: string): string {
  return TYPE_COLORS[type ?? ""] ?? DEFAULT_COLOR;
}

/** Normaliza coordenadas (array ou objeto) → {x,y,w,h} na escala original */
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
 * Converte coordenada da escala do LLM para pixels de exibição no canvas.
 *
 * normalized-1000:
 *   x_display = (x / 1000) * canvasWidth   (não depende da resolução original)
 *
 * pixels:
 *   x_display = x * (canvasWidth / naturalWidth)
 */
function toDisplayPx(
  box:        { x: number; y: number; w: number; h: number },
  scale:      CoordScale,
  canvasW:    number,
  canvasH:    number,
  naturalW:   number,
  naturalH:   number,
): { x: number; y: number; w: number; h: number } {
  if (scale === "normalized-1000") {
    return {
      x: (box.x / 1000) * canvasW,
      y: (box.y / 1000) * canvasH,
      w: (box.w / 1000) * canvasW,
      h: (box.h / 1000) * canvasH,
    };
  }
  // pixels → escala para o tamanho exibido
  const sx = canvasW / naturalW;
  const sy = canvasH / naturalH;
  return { x: box.x * sx, y: box.y * sy, w: box.w * sx, h: box.h * sy };
}

export function AnnotatedImageViewer({
  imageBase64,
  elements,
  coordScale = "normalized-1000",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef    = useRef<HTMLImageElement>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [hovered,    setHovered]    = useState<UiElement | null>(null);
  const [selected,   setSelected]   = useState<UiElement | null>(null);
  const [imgSize,    setImgSize]    = useState({ nw: 0, nh: 0, natW: 0, natH: 0 });

  const dataUri = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/png;base64,${imageBase64}`;

  const types = useMemo(() =>
    ["all", ...Array.from(new Set(elements.map((e) => e.type ?? "?").filter(Boolean)))],
    [elements]
  );

  const visibleElements = useMemo(() =>
    filterType === "all" ? elements : elements.filter((e) => e.type === filterType),
    [elements, filterType]
  );

  function handleImgLoad() {
    const img = imgRef.current;
    if (!img) return;
    setImgSize({ nw: img.clientWidth, nh: img.clientHeight, natW: img.naturalWidth, natH: img.naturalHeight });
  }

  // ── redraw ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || imgSize.nw === 0) return;

    canvas.width  = imgSize.nw;
    canvas.height = imgSize.nh;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    visibleElements.forEach((el) => {
      const raw = toBox(el.coordenadas);
      if (!raw) return;

      const { x, y, w, h } = toDisplayPx(
        raw, coordScale,
        imgSize.nw, imgSize.nh,
        imgSize.natW, imgSize.natH,
      );
      if (w <= 0 || h <= 0) return;

      const color    = getColor(el.type);
      const isActive = el === hovered || el === selected;

      ctx.fillStyle   = isActive ? `${color}40` : `${color}1a`;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth   = isActive ? 3 : 1.5;
      ctx.strokeRect(x, y, w, h);

      if (showLabels && el.id) {
        const label    = `${el.type ?? "?"} · ${el.id}`;
        const fontSize = Math.max(10, Math.min(13, h * 0.6));
        ctx.font         = `${fontSize}px monospace`;
        ctx.textBaseline = "top";
        const tw = ctx.measureText(label).width + 6;
        const th = fontSize + 4;
        const ly = y - th > 0 ? y - th : y + 2;
        ctx.fillStyle = color;
        ctx.fillRect(x, ly, tw, th);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x + 3, ly + 2);
      }
    });
  }, [visibleElements, imgSize, showLabels, hovered, selected, coordScale]);

  // ── hover / click ─────────────────────────────────────────────────────────
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || imgSize.nw === 0) return;

    const rect = canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;

    let found: UiElement | null = null;
    for (let i = visibleElements.length - 1; i >= 0; i--) {
      const raw = toBox(visibleElements[i].coordenadas);
      if (!raw) continue;
      const { x, y, w, h } = toDisplayPx(
        raw, coordScale,
        imgSize.nw, imgSize.nh,
        imgSize.natW, imgSize.natH,
      );
      if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
        found = visibleElements[i];
        break;
      }
    }
    setHovered(found);
  }

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

          {/* Badge de escala */}
          <span style={{
            marginLeft: "auto", fontSize: "0.7rem", padding: "0.15rem 0.55rem",
            borderRadius: "999px", border: "1px solid var(--accent-primary)",
            color: "var(--accent-primary)", fontFamily: "monospace",
          }}>
            escala: {coordScale === "normalized-1000" ? "0–1000" : "pixels"}
          </span>

          <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
            {visibleElements.length} visível(is)
          </span>
        </div>
      </div>

      {/* Legenda */}
      <div className="annotation-legend">
        {Object.entries(TYPE_COLORS).map(([t, c]) => (
          <span
            key={t} className="legend-chip"
            style={{ borderColor: c, color: c, cursor: "pointer", opacity: filterType !== "all" && filterType !== t ? 0.35 : 1 }}
            onClick={() => setFilterType(filterType === t ? "all" : t)}
          >
            <span className="legend-dot" style={{ background: c }} />{t}
          </span>
        ))}
      </div>

      {/* Imagem + Canvas */}
      <div className="annotation-canvas-wrap">
        <img
          ref={imgRef} src={dataUri} alt="screenshot"
          className="annotation-img" onLoad={handleImgLoad} draggable={false}
        />
        <canvas
          ref={canvasRef} className="annotation-canvas"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
          onClick={() => setSelected(hovered)}
          title={activeEl?.id ?? ""}
        />
      </div>

      {/* Detalhe do elemento ativo */}
      {activeEl && (
        <div className="annotation-tooltip">
          <div className="annotation-tooltip-header">
            <span className="job-status-badge success"
              style={{ background: `${getColor(activeEl.type)}22`, color: getColor(activeEl.type), borderColor: getColor(activeEl.type) }}>
              {activeEl.type}
            </span>
            <span className="job-model-name">{activeEl.id}</span>
            {selected && (
              <button className="btn-secondary"
                style={{ marginLeft: "auto", fontSize: "0.7rem", padding: "0.1rem 0.45rem" }}
                onClick={() => setSelected(null)}>
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
