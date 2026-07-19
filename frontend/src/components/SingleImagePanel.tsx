// components/SingleImagePanel.tsx
import React, { useState, useRef } from "react";
import type {
  ProfileKey,
  LLMAPI,
  StepResponse,
  ResultTab,
} from "../types";
import { ResultViewer } from "./ResultViewer";

interface Props {
  apiBase: string;
  sessionId: string;
  profileKey: ProfileKey;
  objective: string;
  llmAPI: LLMAPI;
  selectedModels: string[];
  idsToRemove: string[];
  onResult?: (response: StepResponse) => void;
}

export function SingleImagePanel({
  apiBase,
  sessionId,
  profileKey,
  objective,
  llmAPI,
  selectedModels,
  idsToRemove,
  onResult,
}: Props) {
  const [imageBase64, setImageBase64] = useState("");
  const [fileName, setFileName] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  const [result, setResult] = useState<StepResponse | null>(null);
  const [allResults, setAllResults] = useState<StepResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resultTab, setResultTab] = useState<ResultTab>("clean");

  const stepCounter = useRef(1);

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
    };
    reader.readAsDataURL(file);
  };

  const callAPI = async (step: number): Promise<StepResponse> => {
    const res = await fetch(`${apiBase}/sessions/${sessionId}/steps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        LLMAPI: llmAPI,
        models: selectedModels,
        profiles: [profileKey],
        objective,
        stepIndex: step,
        imageBase64,
        fileName,
        idsToRemove,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any)?.message ?? `HTTP ${res.status}`);
    }
    return res.json();
  };

  const handleSubmit = async () => {
    if (!imageBase64) return setError("Selecione uma imagem.");
    if (!selectedModels.length)
      return setError("Selecione ao menos um modelo.");

    setLoading(true);
    setError("");
    setResult(null);
    const currentStep = stepCounter.current;

    try {
      const response = await callAPI(currentStep);
      stepCounter.current += 1;
      setResult(response);
      setAllResults((prev) => [...prev, response]);
      onResult?.(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="panel">
        <label className="label">Imagem</label>
        <input type="file" accept="image/*" onChange={handleImageChange} />
        {previewUrl && (
          <img
            src={previewUrl}
            alt="preview"
            className="mt-2 max-h-48 rounded"
          />
        )}
      </div>

      {error && <p className="text-error text-sm">{error}</p>}

      <button
        className="btn btn-primary"
        onClick={handleSubmit}
        disabled={loading}
      >
        {loading ? "⏳ Analisando..." : "🚀 Analisar"}
      </button>

      <ResultViewer
        result={result}
        loading={loading}
        resultTab={resultTab}
        onTabChange={setResultTab}
        allResults={allResults}
        previewBase64={imageBase64}
      />
    </div>
  );
}