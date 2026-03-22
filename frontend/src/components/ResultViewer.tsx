// components/ResultViewer.tsx
import React, { useMemo, useState } from "react";
import type { JobResult, ResultTab, StepResponse, UiElement } from "../types";
import { AnnotatedImageViewer } from "./AnnotatedImageViewer";

interface Props {
  result:       StepResponse | null;
  loading:      boolean;
  resultTab:    ResultTab;
  onTabChange:  (t: ResultTab) => void;
  emptyLabel?:  string;
  allResults?:  StepResponse[];
  /** Base64 da imagem original (para sobreposição de anotações) */
  previewBase64?: string;
}

// ── download helper ───────────────────────────────────────────────────────────

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── parse elements do rawResponse quando clean/full estão vazios ─────────────

function parseElementsFromOutput(output: unknown): UiElement[] {
  try {
    const raw = output as any;
    // Tenta primeiro o campo ui (já parseado pelo servidor)
    if (Array.isArray(raw?.ui) && raw.ui.length > 0) return raw.ui as UiElement[];

    const text: string =
      raw?.rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) return [];

    const cleaned = text.trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
    try {
      const arr = JSON.parse(cleaned);
      if (Array.isArray(arr)) return arr as UiElement[];
    } catch {
      const s = cleaned.indexOf("["), e = cleaned.lastIndexOf("]");
      if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1)) as UiElement[];
    }
    return [];
  } catch { return []; }
}

// ── componente principal ──────────────────────────────────────────────────────

export function ResultViewer({
  result, loading, resultTab, onTabChange, emptyLabel,
  allResults = [], previewBase64 = "",
}: Props) {
  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner" />
        <p>Consultando modelos de IA...</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="empty-state">
        <span className="empty-icon">🖼️</span>
        <h3>Pronto para analisar</h3>
        <p>{emptyLabel ?? "Selecione uma imagem, configure os modelos e clique em Analisar."}</p>
      </div>
    );
  }

  return (
    <div className="result-view">
      {/* Toolbar: abas + downloads */}
      <div className="result-tabs">
        {(["annotated", "clean", "full", "output"] as (ResultTab | "annotated")[]).map((t) => (
          <button
            key={t}
            className={`result-tab ${resultTab === (t === "annotated" ? resultTab : t) && (t === "annotated" ? false : true) || (t === "annotated") ? "" : ""} ${(resultTab === t || (t === "annotated" && resultTab === "annotated")) ? "active" : ""}`}
            onClick={() => t !== "annotated" ? onTabChange(t as ResultTab) : onTabChange("annotated" as ResultTab)}
          >
            {t === "annotated" ? "🗺️ Anotada" : t === "clean" ? "✅ clean" : t === "full" ? "📦 full" : "🔩 output"}
          </button>
        ))}

        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--spacing-xs)" }}>
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "0.25rem 0.7rem" }}
            onClick={() => downloadJson(result, `step${result.stepIndex}-results.json`)}
          >
            ⬇️ Este resultado
          </button>
          {allResults.length > 1 && (
            <button
              className="btn-secondary"
              style={{ fontSize: "0.78rem", padding: "0.25rem 0.7rem" }}
              onClick={() => downloadJson(allResults, "all-results.json")}
            >
              ⬇️ Todos ({allResults.length})
            </button>
          )}
        </div>
      </div>

      {/* Meta geral */}
      <div className="meta-cards">
        <div className="meta-card">
          <span className="meta-label">Sessão</span>
          <span className="meta-value">{result.sessionId}</span>
        </div>
        <div className="meta-card">
          <span className="meta-label">Step</span>
          <span className="meta-value">{result.stepIndex}</span>
        </div>
        <div className="meta-card">
          <span className="meta-label">Jobs</span>
          <span className="meta-value">{result.results.length}</span>
        </div>
        <div className="meta-card">
          <span className="meta-label">Objetivo</span>
          <span className="meta-value" style={{ fontSize: "0.78rem", fontWeight: 400 }}>
            {result.objective}
          </span>
        </div>
      </div>

      {/* Aba imagem anotada */}
      {(resultTab as string) === "annotated" && previewBase64 && (
        <AnnotatedImageViewer
          imageBase64={previewBase64}
          elements={result.results.flatMap((r) => parseElementsFromOutput(r.output))}
        />
      )}

      {(resultTab as string) === "annotated" && !previewBase64 && (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <span className="empty-icon">🗺️</span>
          <p>Nenhuma imagem original disponível para anotação.</p>
        </div>
      )}

      {/* Cards de jobs */}
      {(resultTab as string) !== "annotated" && result.results.map((r, i) => (
        <JobCard
          key={i}
          job={r}
          tab={resultTab}
          index={i}
          stepIndex={result.stepIndex}
          previewBase64={previewBase64}
        />
      ))}
    </div>
  );
}

// ── JobCard ───────────────────────────────────────────────────────────────────

interface JobCardProps {
  job:           JobResult;
  tab:           ResultTab;
  index:         number;
  stepIndex:     number;
  previewBase64: string;
}

function JobCard({ job, tab, index, stepIndex, previewBase64 }: JobCardProps) {
  const [showAnnotation, setShowAnnotation] = useState(false);

  const outputData = job.output as any;
  const numberOfComponents: number = outputData?.numberOfComponents ?? 0;
  const confidence:         number = outputData?.confidence        ?? 0;
  const action:             string = outputData?.action            ?? "";
  const rationale:          string = outputData?.rationale         ?? "";
  const usage     = outputData?.rawResponse?.usageMetadata;
  const modelVer  = outputData?.rawResponse?.modelVersion ?? job.model;

  const elements: UiElement[] = useMemo(() => {
    if (tab === "clean" && job.clean?.length) return job.clean;
    if (tab === "full"  && job.full?.length)  return job.full;
    return parseElementsFromOutput(job.output);
  }, [tab, job]);

  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    elements.forEach((el) => { if (el.type) map[el.type] = (map[el.type] ?? 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [elements]);

  const byRegion = useMemo(() => {
    const map: Record<string, number> = {};
    elements.forEach((el) => { if (el.region) map[el.region] = (map[el.region] ?? 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [elements]);

  if (job.status === "error") {
    return (
      <div className="job-result-card">
        <div className="job-result-header">
          <span className="job-status-badge error">error</span>
          <span className="job-model-name">{job.model}</span>
          <span style={{ color: "var(--text-tertiary)" }}>·</span>
          <span className="job-profile-name">{job.profile}</span>
        </div>
        <div className="job-error-body">
          <strong>{job.error?.type}:</strong> {job.error?.message}
        </div>
      </div>
    );
  }

  return (
    <div className="job-result-card">
      {/* Header */}
      <div className="job-result-header">
        <span className="job-status-badge success">success</span>
        <span className="job-model-name">{modelVer}</span>
        <span style={{ color: "var(--text-tertiary)" }}>·</span>
        <span className="job-profile-name">{job.profile}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--spacing-xs)" }}>
          {previewBase64 && elements.length > 0 && (
            <button
              className="btn-secondary"
              style={{ fontSize: "0.72rem", padding: "0.15rem 0.6rem" }}
              onClick={() => setShowAnnotation((v) => !v)}
            >
              {showAnnotation ? "🙈 Ocultar" : "🗺️ Ver anotada"}
            </button>
          )}
          <button
            className="btn-secondary"
            style={{ fontSize: "0.72rem", padding: "0.15rem 0.6rem" }}
            onClick={() => downloadJson(job.output, `step${stepIndex}-job${index}-${job.model.replace(/\//g, "_")}.json`)}
          >
            ⬇️ JSON
          </button>
        </div>
      </div>

      {/* Métricas */}
      <div className="meta-cards" style={{ padding: "var(--spacing-md)", borderBottom: "1px solid var(--border-color)" }}>
        <div className="meta-card">
          <span className="meta-label">Componentes (modelo)</span>
          <span className="meta-value" style={{ fontSize: "1.4rem", color: "var(--accent-primary)" }}>
            {numberOfComponents}
          </span>
        </div>
        <div className="meta-card">
          <span className="meta-label">Componentes (parsed)</span>
          <span className="meta-value" style={{ fontSize: "1.4rem", color: "var(--success)" }}>
            {elements.length}
          </span>
        </div>
        <div className="meta-card">
          <span className="meta-label">Confiança</span>
          <span className="meta-value">
            <div style={{ marginBottom: 4 }}>{confidence}%</div>
            <div className="confidence-bar">
              <div className="confidence-fill" style={{ width: `${Math.min(confidence, 100)}%` }} />
            </div>
          </span>
        </div>
        {usage && (
          <div className="meta-card">
            <span className="meta-label">Tokens</span>
            <span className="meta-value" style={{ fontSize: "0.82rem" }}>
              ↑ {usage.promptTokenCount} · ↓ {usage.candidatesTokenCount}
              {usage.thoughtsTokenCount ? ` · 💭 ${usage.thoughtsTokenCount}` : ""}
            </span>
          </div>
        )}
      </div>

      {/* Action + Rationale */}
      {(action || rationale) && (
        <div style={{ padding: "var(--spacing-md)", borderBottom: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "var(--spacing-sm)" }}>
          {action && <div className="action-text"><strong>Ação sugerida:</strong> {action}</div>}
          {rationale && <div className="rationale-text">{rationale}</div>}
        </div>
      )}

      {/* Distribuição por tipo e região */}
      {(byType.length > 0 || byRegion.length > 0) && (
        <div style={{ padding: "var(--spacing-md)", borderBottom: "1px solid var(--border-color)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-md)" }}>
          {byType.length > 0 && (
            <div>
              <span className="meta-label" style={{ display: "block", marginBottom: 6 }}>Por tipo</span>
              <div className="field-tags">
                {byType.map(([type, count]) => (
                  <span key={type} className="tag">{type} <strong>{count}</strong></span>
                ))}
              </div>
            </div>
          )}
          {byRegion.length > 0 && (
            <div>
              <span className="meta-label" style={{ display: "block", marginBottom: 6 }}>Por região</span>
              <div className="field-tags">
                {byRegion.map(([region, count]) => (
                  <span key={region} className="tag">{region} <strong>{count}</strong></span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Imagem anotada inline (toggle) */}
      {showAnnotation && previewBase64 && (
        <div style={{ borderBottom: "1px solid var(--border-color)" }}>
          <AnnotatedImageViewer imageBase64={previewBase64} elements={elements} />
        </div>
      )}

      {/* JSON body */}
      <pre className="job-json-body">
        {JSON.stringify(tab === "output" ? job.output : elements, null, 2)}
      </pre>
    </div>
  );
}
