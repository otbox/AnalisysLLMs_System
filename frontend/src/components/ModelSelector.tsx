// components/ModelSelector.tsx
import React, { useState, useEffect } from "react";
import { type LLMAPI, MODEL_GROUPS } from "../types";

interface Props {
  selectedModels: string[];
  onChange:       (models: string[]) => void;
  llmAPI:         LLMAPI;
  /** URL base da API (ex: "http://localhost:3000") — necessário para buscar modelos OpenRouter */
  apiBase:        string;
}

export function ModelSelector({ selectedModels, onChange, llmAPI, apiBase }: Props) {
  const [newModel,             setNewModel]             = useState("");
  const [backendModels,        setBackendModels]        = useState<string[]>([]);
  const [loadingBackendModels, setLoadingBackendModels] = useState(false);

  // ── Carrega modelos dinâmicos do backend quando OpenRouter está selecionado ──
  useEffect(() => {
    if (llmAPI !== "OPENROUTER") {
      setBackendModels([]);
      return;
    }

    const readModelsAvailable = async () => {
      try {
        setLoadingBackendModels(true);

        const res = await fetch(`${apiBase}/openrouter/models`, {
          method:  "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
          const msg = await res.text();
          console.error(msg);
          alert("Erro ao carregar modelos do backend");
          return;
        }

        const data = await res.json();
        // O backend devolve array de strings; adapte se vier objeto
        setBackendModels(Array.isArray(data) ? data : []);
        console.log("Modelos disponíveis (backend):", data);
      } catch (e) {
        console.error("Erro ao carregar modelos do backend", e);
      } finally {
        setLoadingBackendModels(false);
      }
    };

    readModelsAvailable();
  }, [llmAPI, apiBase]);

  // Lista final: modelos estáticos do grupo + modelos do backend (sem duplicatas)
  const groupModels = MODEL_GROUPS[llmAPI] ?? [];
  const allModels   = Array.from(new Set([...groupModels, ...backendModels]));

  // ── helpers ────────────────────────────────────────────────────────────────

  const toggle = (model: string) =>
    onChange(
      selectedModels.includes(model)
        ? selectedModels.filter((m) => m !== model)
        : [...selectedModels, model]
    );

  const add = () => {
    const m = newModel.trim();
    if (m && !selectedModels.includes(m)) onChange([...selectedModels, m]);
    setNewModel("");
  };

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="panel-section">
      <div className="section-header">
        <h2 className="section-title">🧠 Modelos</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-xs)" }}>
          {loadingBackendModels && (
            <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 4 }}>
              <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
              carregando...
            </span>
          )}
          <span className="badge">{selectedModels.length}</span>
        </div>
      </div>

      {/* Label do grupo */}
      <label className="input-label">
        {llmAPI === "GEMINI" ? "🔵 Gemini" : llmAPI === "OLLAMA" ? "🟢 Ollama" : "🟠 OpenRouter"}
        {llmAPI === "OPENROUTER" && backendModels.length > 0 && (
          <span style={{ marginLeft: 6, fontSize: "0.7rem", color: "var(--accent-green)" }}>
            +{backendModels.length} do backend
          </span>
        )}
      </label>

      <ul className="models-list">
        {allModels.map((m) => {
          const isActive    = selectedModels.includes(m);
          const isFromBack  = backendModels.includes(m) && !MODEL_GROUPS[llmAPI]?.includes(m);
          return (
            <li key={m} className="model-item">
              <span className="model-name" title={m}>
                {m}
                {isFromBack && (
                  <span style={{ marginLeft: 4, fontSize: "0.65rem", color: "var(--accent-green)", opacity: 0.8 }}>
                    ↑backend
                  </span>
                )}
              </span>
              <button
                className={`btn-remove ${isActive ? "active" : ""}`}
                onClick={() => toggle(m)}
                title={isActive ? "Remover" : "Adicionar"}
              >
                {isActive ? "✕" : "+"}
              </button>
            </li>
          );
        })}

        {loadingBackendModels && (
          <li className="model-item" style={{ opacity: 0.5, pointerEvents: "none" }}>
            <span className="model-name" style={{ fontStyle: "italic" }}>Buscando modelos...</span>
          </li>
        )}

        {!loadingBackendModels && allModels.length === 0 && (
          <li className="model-item" style={{ opacity: 0.5 }}>
            <span className="model-name" style={{ fontStyle: "italic" }}>Nenhum modelo encontrado</span>
          </li>
        )}
      </ul>

      {/* Modelos personalizados ativos que não estão na lista */}
      {selectedModels.filter((m) => !allModels.includes(m)).length > 0 && (
        <>
          <label className="input-label">Personalizados ativos</label>
          <ul className="models-list">
            {selectedModels
              .filter((m) => !allModels.includes(m))
              .map((m) => (
                <li key={m} className="model-item">
                  <span className="model-name">{m}</span>
                  <button className="btn-remove active" onClick={() => toggle(m)}>✕</button>
                </li>
              ))}
          </ul>
        </>
      )}

      {/* Adicionar modelo personalizado */}
      <div className="add-model-row">
        <input
          className="input-field"
          placeholder="Modelo personalizado..."
          value={newModel}
          onChange={(e) => setNewModel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn-add" onClick={add}>+</button>
      </div>
    </div>
  );
}
