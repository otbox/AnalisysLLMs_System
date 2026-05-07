// components/ProfilePanel.tsx
import React, { useState, useRef, useCallback } from "react";
import {
  type ProfileConfig,
  type ProfileKey,
  type LLMAPI,
  type QueueItem,
  type ResultTab,
  type StepResponse,
  type UiElement,
} from "../types";
import { ModelSelector }  from "./ModelSelector";
import { CleanupSection } from "./CleanupSection";
import { ResultViewer }   from "./ResultViewer";
import { BatchPanel }     from "./BatchPanel";

interface Props {
  profile:        ProfileConfig;
  sessionId:      string;
  apiBase:        string;
  selectedModels: string[];
  onModelsChange: (models: string[]) => void;
}

type InputTab = "single" | "batch";

export function ProfilePanel({
  profile, sessionId, apiBase, selectedModels, onModelsChange,
}: Props) {
  const [objective, setObjective] = useState(profile.defaultObjective);

  // ── Step index ──────────────────────────────────────────────────────────────
  const stepCounter                         = useRef(1);
  const [stepIndexInput, setStepIndexInput] = useState<string>("1");

  const [llmAPI,    setLlmAPI]    = useState<LLMAPI>("GEMINI");
  const [inputTab,  setInputTab]  = useState<InputTab>("single");

  // Single image
  const [imageBase64, setImageBase64] = useState("");
  const [fileName,    setFileName]    = useState("");
  const [previewUrl,  setPreviewUrl]  = useState("");

  // Cleanup
  const [idsToRemoveInput,    setIdsToRemoveInput]    = useState("");
  const [detectedIds,         setDetectedIds]         = useState<string[]>([]);
  const [selectedIdsToRemove, setSelectedIdsToRemove] = useState<Set<string>>(new Set());

  // Results
  const [result,      setResult]      = useState<StepResponse | null>(null);
  const [allResults,  setAllResults]  = useState<StepResponse[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [resultTab,   setResultTab]   = useState<ResultTab>("clean");

  // Batch
  const [batchQueue,         setBatchQueue]         = useState<QueueItem[]>([]);
  const [isProcessingBatch,  setIsProcessingBatch]  = useState(false);
  const batchRunning = useRef(false);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const resolvedStepIndex = (): number => {
    const parsed = parseInt(stepIndexInput, 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : stepCounter.current;
  };

  const advanceStep = () => {
    const next = resolvedStepIndex() + 1;
    stepCounter.current = next;
    setStepIndexInput(String(next));
  };

  const idsToRemoveArray = () => [
    ...new Set([
      ...idsToRemoveInput.split(",").map((s) => s.trim()).filter(Boolean),
      ...selectedIdsToRemove,
    ]),
  ];

  const toggleIdToRemove = (id: string) =>
    setSelectedIdsToRemove((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Single image ─────────────────────────────────────────────────────────────

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name.replace(/\.[^/.]+$/, ""));
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      setImageBase64(dataUri.split(",")[1]);
      setPreviewUrl(dataUri);
      setDetectedIds([]);
      setSelectedIdsToRemove(new Set());
      setResult(null);
    };
    reader.readAsDataURL(file);
  };

  // ── Folder / batch ───────────────────────────────────────────────────────────

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    let loaded = 0;
    const newItems: QueueItem[] = [];
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        newItems.push({
          id:          crypto.randomUUID(),
          fileName:    file.name.replace(/\.[^/.]+$/, ""),
          imageBase64: (reader.result as string).split(",")[1],
          status:      "pending",
        });
        if (++loaded === files.length)
          setBatchQueue((prev) => [...prev, ...newItems]);
      };
      reader.readAsDataURL(file);
    });
  };

  // ── API call ─────────────────────────────────────────────────────────────────

  const callAPI = async (
    img:         string,
    file:        string,
    step:        number,
    idsToRemove: string[],
  ): Promise<StepResponse> => {
    const res = await fetch(`${apiBase}/sessions/${sessionId}/steps`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        LLMAPI:      llmAPI,
        models:      selectedModels,
        profiles:    [profile.key] as ProfileKey[],
        objective,
        stepIndex:   step,
        imageBase64: img,
        fileName:    file,
        idsToRemove,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any)?.message ?? `HTTP ${res.status}`);
    }
    return res.json();
  };

  // ── Submit single ───────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!imageBase64)           return setError("Select an image.");
    if (!selectedModels.length) return setError("Select at least one model.");

    setLoading(true); setError(""); setResult(null);
    const currentStep = resolvedStepIndex();

    try {
      const response = await callAPI(imageBase64, fileName, currentStep, idsToRemoveArray());
      advanceStep();
      setResult(response);
      setAllResults((prev) => [...prev, response]);
      const ids = response.results
        .flatMap((r) => r.full ?? [])
        .map((el: UiElement) => el.id)
        .filter((id): id is string => !!id);
      setDetectedIds([...new Set(ids)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  };

  // ── Batch ──────────────────────────────────────────────────────────────────

  const processBatch = useCallback(() => {
    if (batchRunning.current) return;
    batchRunning.current = true;
    setIsProcessingBatch(true);

    const processNext = () => {
      setBatchQueue((prev) => {
        const idx = prev.findIndex((i) => i.status === "pending");
        if (idx === -1) {
          batchRunning.current = false;
          setIsProcessingBatch(false);
          return prev;
        }
        const updated = [...prev];
        updated[idx]  = { ...updated[idx], status: "running" };
        const item    = updated[idx];
        const step    = resolvedStepIndex();

        (async () => {
          try {
            const response = await callAPI(item.imageBase64, item.fileName, step, idsToRemoveArray());
            advanceStep();
            setBatchQueue((q) =>
              q.map((i) => i.id === item.id ? { ...i, status: "done", response } : i)
            );
            setAllResults((prev) => [...prev, response]);
          } catch (err) {
            setBatchQueue((q) =>
              q.map((i) =>
                i.id === item.id
                  ? { ...i, status: "error", error: err instanceof Error ? err.message : "Error" }
                  : i
              )
            );
          } finally {
            processNext();
          }
        })();

        return updated;
      });
    };

    processNext();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModels, llmAPI, objective, idsToRemoveInput, selectedIdsToRemove, stepIndexInput]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="layout">

      {/* ── Sidebar ── */}
      <aside className="config-panel">

        <div className="panel-section">
          <div className="section-header">
            <h2 className="section-title">⚙️ Configuration</h2>
          </div>

          {/* AI Service */}
          <div className="input-group">
            <label className="input-label">AI Service</label>
            <div style={{ display: "flex", gap: "var(--spacing-sm)" }}>
              {(["GEMINI", "OPENROUTER"] as LLMAPI[]).map((api) => (
                <button
                  key={api}
                  className="btn-secondary"
                  style={
                    llmAPI === api
                      ? { borderColor: "var(--accent-primary)", color: "var(--accent-primary)", fontWeight: 600 }
                      : {}
                  }
                  onClick={() => setLlmAPI(api)}
                >
                  {api === "GEMINI" ? "🔵 Gemini" : "🟠 OpenRouter"}
                </button>
              ))}
            </div>
          </div>

          {/* Objective */}
          <div className="input-group">
            <label className="input-label">Objective</label>
            <textarea
              className="textarea-field"
              rows={4}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </div>

          {/* Step Index */}
          <div className="input-group">
            <label className="input-label">Step Index</label>
            <input
              className="input-field"
              type="number"
              min={1}
              value={stepIndexInput}
              onChange={(e) => {
                setStepIndexInput(e.target.value);
                const parsed = parseInt(e.target.value, 10);
                if (Number.isFinite(parsed) && parsed >= 1) stepCounter.current = parsed;
              }}
            />
            <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
              Auto-increments after each successful submission. You can edit it manually.
            </span>
          </div>
        </div>

        <ModelSelector selectedModels={selectedModels} onChange={onModelsChange} llmAPI={llmAPI} apiBase={apiBase} />

        <CleanupSection
          idsToRemoveInput={idsToRemoveInput}
          onInputChange={setIdsToRemoveInput}
          detectedIds={detectedIds}
          selectedIdsToRemove={selectedIdsToRemove}
          onToggleId={toggleIdToRemove}
        />

        {/* History */}
        {allResults.length > 0 && (
          <div className="panel-section">
            <div className="section-header">
              <h2 className="section-title">📋 History</h2>
              <span className="badge">{allResults.length}</span>
            </div>
            <ul className="models-list">
              {allResults.map((r, i) => (
                <li
                  key={i}
                  className="model-item"
                  style={{ cursor: "pointer" }}
                  onClick={() => setResult(r)}
                >
                  <span className="model-name">Step {r.stepIndex} — {r.results.length} job(s)</span>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>view</span>
                </li>
              ))}
            </ul>
            <button
              className="btn-danger"
              style={{ fontSize: "0.78rem" }}
              onClick={() => setAllResults([])}
            >
              🗑️ Clear history
            </button>
          </div>
        )}

      </aside>

      {/* ── Main ── */}
      <main className="results-panel">

        <div className="tabs">
          {(["single", "batch"] as InputTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={inputTab === tab ? "tab tab-active" : "tab"}
              onClick={() => setInputTab(tab)}
            >
              {tab === "single"
                ? "🖼️ Single image"
                : `📁 Folder (batch)${batchQueue.length > 0 ? ` (${batchQueue.length})` : ""}`}
            </button>
          ))}
        </div>

        {/* ── Single ── */}
        {inputTab === "single" && (
          <>
            <div className="results-header">
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Image</label>
                <input type="file" accept="image/*" className="input-field" onChange={handleImageChange} />
              </div>
            </div>

            {previewUrl && (
              <div style={{ padding: "0 var(--spacing-lg)" }}>
                <img src={previewUrl} alt="preview" className="image-preview" />
              </div>
            )}

            {error && (
              <div style={{ padding: "0 var(--spacing-lg)" }}>
                <div className="alert danger">{error}</div>
              </div>
            )}

            <div className="input-bar">
              <button
                className="btn-primary"
                onClick={handleSubmit}
                disabled={loading || !imageBase64}
              >
                {loading ? "⏳ Analysing..." : "🚀 Analyse"}
              </button>
            </div>

            <div className="results-content">
              <ResultViewer
                result={result}
                loading={loading}
                resultTab={resultTab}
                onTabChange={setResultTab}
                allResults={allResults}
                previewBase64={imageBase64}
              />
            </div>
          </>
        )}

        {/* ── Batch ── */}
        {inputTab === "batch" && (
          <div className="results-content">
            <BatchPanel
              queue={batchQueue}
              isProcessing={isProcessingBatch}
              onFolderChange={handleFolderChange}
              onStart={processBatch}
              onClear={() => { if (!isProcessingBatch) setBatchQueue([]); }}
            />
          </div>
        )}

      </main>
    </div>
  );
}
