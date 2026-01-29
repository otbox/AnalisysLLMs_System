"use client";

import { useState } from "react";
import "./App.css";

type ProfileKey = "GuideLLM" | "AnalisysComponentsLLM" | "CongnitiveWalktroughLLM";

type UiComponent = {
  id: string;
  type: string;
  text?: string;
  state?: string;
  region?: string;
  actions?: string[];
  meta?: Record<string, unknown>;
};

type UiComponents = {
  components?: UiComponent[];
};

type StepResult = {
  profile: ProfileKey;
  model: string;
  action: string;
  rationale: string;
  confidence: number;
  latencyMs?: number;
  rawResponse?: unknown;
  ui?: UiComponents | UiComponent[] | null;
};

type ApiResult = {
  stepIndex: number;
  objective: string;
  results: StepResult[];
};

// Função melhorada para extrair e fazer parse do JSON da UI
function parseUiFromRaw(raw: any): UiComponent[] | null {
  try {
    // Extrair o texto da resposta (suporta múltiplos formatos)
    let textContent: string | null = null;

    // Formato Parasail/Molmo/OpenAI: choices[0].message.content
    const msgContent = raw?.choices?.[0]?.message?.content;
    if (typeof msgContent === "string") {
      textContent = msgContent;
    }

    // Formato Gemini: candidates[0].content.parts[0].text
    if (!textContent) {
      const partText = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof partText === "string") {
        textContent = partText;
      }
    }

    if (!textContent) return null;

    // Fazer parse do JSON
    const parsed = JSON.parse(textContent);

    // Se é um array direto de componentes
    if (Array.isArray(parsed)) {
      return parsed;
    }

    // Se tem a propriedade components
    if (parsed.components && Array.isArray(parsed.components)) {
      return parsed.components;
    }

    // Se é um objeto único, transformar em array
    if (typeof parsed === "object" && parsed.id) {
      return [parsed];
    }

    return null;
  } catch (error) {
    console.error("Erro ao fazer parse da UI:", error);
    return null;
  }
}

export default function LlmTesterPage() {
  const [sessionId, setSessionId] = useState("sess-001");
  const [models, setModels] = useState<string[]>(["google/gemma-3-27b-it:free", "allenai/molmo-2-8b:free"]);
  const [newModel, setNewModel] = useState("");
  const [profiles, setProfiles] = useState<ProfileKey[]>(["AnalisysComponentsLLM"]);
  const [objective, setObjective] = useState("");
  const [stepIndex, setStepIndex] = useState(1);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [responses, setResponses] = useState<StepResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [loading, setLoading] = useState(false);

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleSend() {
    try {
      setLoading(true);

      let imageBase64: string | undefined;
      if (imageFile) {
        const dataUrl = await fileToBase64(imageFile);
        const [, base64] = dataUrl.split(",");
        imageBase64 = base64 ?? dataUrl;
      }

      let uiJson: string | undefined;
      if (jsonText.trim()) {
        try {
          JSON.parse(jsonText);
          uiJson = jsonText;
        } catch {
          alert("JSON inválido");
          setLoading(false);
          return;
        }
      }

      const body = {
        models,
        objective,
        stepIndex,
        imageBase64,
        uiJson,
        profiles,
      };

      const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const msg = await res.text();
        console.error(msg);
        alert("Erro ao chamar backend");
        setLoading(false);
        return;
      }

      const data: ApiResult = await res.json();

      console.log("Resposta da API:", data);

      // Processar cada resultado e extrair os componentes da UI
      const enriched: StepResult[] = data.results.map(r => {
        const uiComponents = parseUiFromRaw(r.rawResponse);
        console.log(`Componentes parseados (${r.profile}):`, uiComponents);
        
        return {
          ...r,
          ui: uiComponents,
        };
      });

      console.log("Resultados enriquecidos:", enriched);
      setResponses(enriched);
      setSelectedIndex(enriched.length > 0 ? 0 : null);

      setLoading(false);
    } catch (err) {
      console.error("ERRO HANDLE_SEND", err);
      alert(String(err));
      setLoading(false);
    }
  }

  function handleDownloadCurrent() {
    if (selectedIndex == null) return;
    const current = responses[selectedIndex];
    if (!current) return;

    const blob = new Blob([JSON.stringify(current, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${current.profile}-${current.model}-response.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadAll() {
    const blob = new Blob([JSON.stringify(responses, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `all-responses.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleRemoveModel(model: string) {
    setModels(prev => prev.filter(m => m !== model));
  }

  const current =
    selectedIndex != null && selectedIndex >= 0 && selectedIndex < responses.length
      ? responses[selectedIndex]
      : null;

  const profileLabels: Record<ProfileKey, string> = {
    GuideLLM: "🧭 Guia de Navegação",
    AnalisysComponentsLLM: "🔍 Análise de Componentes",
    CongnitiveWalktroughLLM: "🧠 Walkthrough Cognitivo",
  };

  // Função helper para renderizar um componente individual
  function renderComponent(component: UiComponent, index: number) {
    return (
      <div key={component.id || index} className="component-card">
        <div className="component-header">
          <span className="component-type">{component.type}</span>
          <span className="component-id">{component.id}</span>
        </div>
        
        {component.text && (
          <div className="component-field">
            <span className="field-label">Texto:</span>
            <span className="field-value">{component.text}</span>
          </div>
        )}
        
        {component.region && (
          <div className="component-field">
            <span className="field-label">Região:</span>
            <span className="field-value">{component.region}</span>
          </div>
        )}
        
        {component.state && (
          <div className="component-field">
            <span className="field-label">Estado:</span>
            <span className="field-value">{component.state}</span>
          </div>
        )}
        
        {component.actions && component.actions.length > 0 && (
          <div className="component-field">
            <span className="field-label">Ações:</span>
            <div className="field-tags">
              {component.actions.map((action, idx) => (
                <span key={idx} className="tag">{action}</span>
              ))}
            </div>
          </div>
        )}
        
        {component.meta && Object.keys(component.meta).length > 0 && (
          <div className="component-field">
            <span className="field-label">Metadados:</span>
            <pre className="field-json">{JSON.stringify(component.meta, null, 2)}</pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`app ${theme}`}>
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="logo">🤖 LLM Tester</h1>
          <div className="session-group">
            <label className="session-label">Sessão</label>
            <input
              value={sessionId}
              onChange={e => setSessionId(e.target.value)}
              className="session-input"
              placeholder="sess-001"
            />
          </div>
        </div>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="theme-toggle"
          aria-label="Alternar tema"
        >
          {theme === "dark" ? "☀️ Claro" : "🌙 Escuro"}
        </button>
      </header>

      <main className="layout">
        {/* Painel de Configuração */}
        <aside className="config-panel">
          <div className="panel-section">
            <h2 className="section-title">⚙️ Configuração</h2>

            <label className="input-group">
              <span className="input-label">Passo do Teste</span>
              <input
                type="number"
                value={stepIndex}
                min={1}
                onChange={e => setStepIndex(Number(e.target.value) || 1)}
                className="input-field"
              />
            </label>
          </div>

          {/* Modelos */}
          <div className="panel-section">
            <div className="section-header">
              <h3 className="section-title">🎯 Modelos</h3>
              <span className="badge">{models.length}</span>
            </div>

            <ul className="models-list">
              {models.map(m => (
                <li key={m} className="model-item">
                  <span className="model-name">{m}</span>
                  <button
                    onClick={() => handleRemoveModel(m)}
                    className="btn-remove"
                    aria-label="Remover modelo"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            <div className="add-model-row">
              <input
                value={newModel}
                onChange={e => setNewModel(e.target.value)}
                placeholder="Nome do modelo..."
                className="input-field"
                onKeyPress={e => {
                  if (e.key === "Enter") {
                    const trimmed = newModel.trim();
                    if (trimmed && !models.includes(trimmed)) {
                      setModels(prev => [...prev, trimmed]);
                      setNewModel("");
                    }
                  }
                }}
              />
              <button
                onClick={() => {
                  const trimmed = newModel.trim();
                  if (!trimmed) return;
                  if (!models.includes(trimmed)) {
                    setModels(prev => [...prev, trimmed]);
                  }
                  setNewModel("");
                }}
                className="btn-add"
              >
                +
              </button>
            </div>
          </div>

          {/* Perfis */}
          <div className="panel-section">
            <h3 className="section-title">📋 Perfis de Teste</h3>
            <div className="profiles-list">
              {(["GuideLLM", "AnalisysComponentsLLM", "CongnitiveWalktroughLLM"] as ProfileKey[]).map(
                p => (
                  <label key={p} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={profiles.includes(p)}
                      onChange={e => {
                        if (e.target.checked) {
                          setProfiles(prev => (prev.includes(p) ? prev : [...prev, p]));
                        } else {
                          setProfiles(prev => prev.filter(x => x !== p));
                        }
                      }}
                      className="checkbox-input"
                    />
                    <span className="checkbox-label">{profileLabels[p]}</span>
                  </label>
                ),
              )}
            </div>
          </div>

          {/* Uploads */}
          <div className="panel-section">
            <h3 className="section-title">📎 Anexos</h3>

            <label className="input-group">
              <span className="input-label">JSON da Interface</span>
              <textarea
                value={jsonText}
                onChange={e => setJsonText(e.target.value)}
                placeholder="Cole o JSON da UI aqui..."
                className="textarea-field"
                rows={4}
              />
            </label>

            <label className="input-group">
              <span className="input-label">Imagem da Tela</span>
              <div className="file-input-wrapper">
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => {
                    const f = e.target.files?.[0] ?? null;
                    setImageFile(f);
                  }}
                  className="file-input"
                  id="image-upload"
                />
                <label htmlFor="image-upload" className="file-label">
                  {imageFile ? `📷 ${imageFile.name}` : "📁 Escolher arquivo"}
                </label>
              </div>
            </label>
          </div>
        </aside>

        {/* Painel de Resultados */}
        <section className="results-panel">
          <div className="results-header">
            <select
              value={selectedIndex != null ? String(selectedIndex) : ""}
              onChange={e => setSelectedIndex(Number(e.target.value))}
              className="result-selector"
            >
              <option value="" disabled>
                Selecione um resultado
              </option>
              {responses.map((r, idx) => (
                <option key={`${r.profile}-${r.model}-${idx}`} value={idx}>
                  {profileLabels[r.profile]} – {r.model}
                </option>
              ))}
            </select>

            <div className="header-buttons">
              <button
                onClick={handleDownloadCurrent}
                disabled={!current}
                className="btn-secondary"
              >
                💾 Baixar Atual
              </button>
              <button
                onClick={handleDownloadAll}
                disabled={responses.length === 0}
                className="btn-secondary"
              >
                📦 Baixar Todas
              </button>
            </div>
          </div>

          <div className="results-content">
            {loading && (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Consultando modelos de IA...</p>
              </div>
            )}

            {!loading && current && (
              <div className="result-view">
                <div className="meta-cards">
                  <div className="meta-card">
                    <span className="meta-label">Perfil</span>
                    <span className="meta-value">{profileLabels[current.profile]}</span>
                  </div>
                  <div className="meta-card">
                    <span className="meta-label">Modelo</span>
                    <span className="meta-value">{current.model}</span>
                  </div>
                  {current.latencyMs != null && (
                    <div className="meta-card">
                      <span className="meta-label">⚡ Latência</span>
                      <span className="meta-value">{current.latencyMs} ms</span>
                    </div>
                  )}
                  <div className="meta-card">
                    <span className="meta-label">🎯 Confiança</span>
                    <span className="meta-value confidence">
                      {current.confidence}%
                      <div className="confidence-bar">
                        <div
                          className="confidence-fill"
                          style={{ width: `${current.confidence}%` }}
                        />
                      </div>
                    </span>
                  </div>
                </div>

                {current?.action && (
                  <div className="result-section">
                    <h3 className="result-heading">💡 Ação Sugerida</h3>
                    <p className="action-text">{current.action}</p>
                  </div>
                )}

                {current?.ui && Array.isArray(current.ui) && current.ui.length > 0 && (
                  <div className="result-section">
                    <h3 className="result-heading">
                      🧱 Componentes Detectados ({current.ui.length})
                    </h3>
                    <div className="components-grid">
                      {current.ui.map((component, index) => renderComponent(component, index))}
                    </div>
                  </div>
                )}

                {current?.rationale && (
                  <div className="result-section">
                    <h3 className="result-heading">📝 Justificativa</h3>
                    <pre className="rationale-text">{current.rationale}</pre>
                  </div>
                )}
              </div>
            )}

            {!loading && !current && (
              <div className="empty-state">
                <div className="empty-icon">🚀</div>
                <h3>Pronto para testar</h3>
                <p>Defina o objetivo, configure os modelos e perfis, então clique em Enviar para começar.</p>
              </div>
            )}
          </div>

          <div className="input-bar">
            <input
              className="objective-input"
              value={objective}
              onChange={e => setObjective(e.target.value)}
              placeholder="Descreva o objetivo do teste ou percurso do usuário..."
              onKeyPress={e => {
                if (e.key === "Enter" && !loading && objective.trim() && models.length) {
                  handleSend();
                }
              }}
            />
            <button
              onClick={handleSend}
              disabled={loading || !objective.trim() || !models.length}
              className="btn-primary"
            >
              {loading ? "⏳ Enviando..." : "🚀 Enviar"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
