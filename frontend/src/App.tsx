"use client";

import { useEffect, useState } from "react";
import "./App.css";

type ProfileKey = "GuideLLM" | "AnalisysComponentsLLM" | "CongnitiveWalktroughLLM";

type NvidiaBox = {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
};

type NvidiaCategory = "table" | "title" | "paragraph" | "infographic" | "header_footer";

type NvidiaDetections = {
  [K in NvidiaCategory]?: NvidiaBox[];
};

type NvidiaApiResult = {
  sessionId: string;
  detections: {
    data: Array<{
      index: number;
      bounding_boxes: Record<string, NvidiaBox[]>;
    }>;
    usage: unknown;
  };
  rawResponse: unknown;
};

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
  temperature?: number;
  promptVersion?: string;
  runIndex?: number;
  execId?: number;
  latencyMs?: number;
  rawResponse?: unknown;
  ui?: UiComponents | UiComponent[] | null;
  savedPath?: string;
};

type ApiResult = {
  stepIndex: number;
  objective: string;
  temperature?: number;
  promptVersion?: string;
  results: StepResult[];
};

type FinalDomain = "Americanas" | "Limeira" | "LibreOffice";

type FinalCaseSummary = {
  domain: FinalDomain;
  caseId: string;
  testNumber: number | null;
  testVersion: string | null;
  relativeImagePath: string;
  hasUiJson: boolean;
};


function parseUiFromRaw(raw: any): UiComponent[] | null {
  try {
    
    let textContent: string | null = null;

    const msgContent = raw?.choices?.[0]?.message?.content;
    if (typeof msgContent === "string") {
      textContent = msgContent;
    }


    if (!textContent) {
      const partText = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof partText === "string") {
        textContent = partText;
      }
    }

    if (!textContent) return null;


    const parsed = JSON.parse(textContent);


    if (Array.isArray(parsed)) {
      return parsed;
    }


    if (parsed.components && Array.isArray(parsed.components)) {
      return parsed.components;
    }


    if (typeof parsed === "object" && parsed.id) {
      return [parsed];
    }

    return null;
  } catch (error) {
    console.error("Erro ao fazer parse da UI:", error);
    return null;
  }
}

type LLMAPIType = "OPENROUTER" | "GEMINI" | "NVIDIA"

export default function LlmTesterPage() {
  const [sessionId, setSessionId] = useState("sess-001");
  const [availableModels, setAvailableModels] = useState<string[]>([]); 
  const [usingModels, setUsingModels] = useState<string[]>([]); 
  const [newModel, setNewModel] = useState("");
  const [LLMAPI, setLLMAPI] = useState<LLMAPIType>("GEMINI")
  const [profiles, setProfiles] = useState<ProfileKey[]>(["AnalisysComponentsLLM"]);
  const [objective, setObjective] = useState("");
  const [stepIndex, setStepIndex] = useState(1);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [responses, setResponses] = useState<StepResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [temperature, setTemperature] = useState(0.2);
  const [promptVersion, setPromptVersion] = useState("v1");
  const [promptVersions, setPromptVersions] = useState<string[]>(["v1"]);
  const [saveToDisk, setSaveToDisk] = useState(true);
  const [domain, setDomain] = useState<FinalDomain>("Americanas");
  const [testNumber, setTestNumber] = useState<number>(1);
  const [testVersion, setTestVersion] = useState("v0a");
  const [caseId, setCaseId] = useState("1v0a");
  const [finalCases, setFinalCases] = useState<FinalCaseSummary[]>([]);
  const [selectedFinalCaseId, setSelectedFinalCaseId] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [runsPerVersion, setRunsPerVersion] = useState(1);
  const [batchPromptVersions, setBatchPromptVersions] = useState<string[]>(["v1"]);

  const [loading, setLoading] = useState(false);
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

  useEffect(() => {
    fetch(`${API_BASE_URL}/meta/analisys-prompts`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (Array.isArray(data.versions) && data.versions.length) {
          setPromptVersions(data.versions);
          setBatchPromptVersions([data.defaultVersion ?? data.versions[0]]);
        }
        if (data.defaultVersion) setPromptVersion(data.defaultVersion);
        if (typeof data.defaultTemperature === "number") {
          setTemperature(data.defaultTemperature);
        }
      })
      .catch(() => undefined);
  }, [API_BASE_URL]);

  useEffect(() => {
    setUsingModels([]);
    switch (LLMAPI) {
      case "GEMINI":
        setAvailableModels([]);
        setUsingModels(["gemini-2.5-flash"]);
        break;
      case "NVIDIA":
        setAvailableModels([]);
        setUsingModels(["nemotriever"]);
        break;
      case "OPENROUTER":
        readModelsAvaible();
        break;
    }
  }, [LLMAPI])

  async function readModelsAvaible() {
    try {
      const res = await fetch(`${API_BASE_URL}/openrouter/models`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const msg = await res.text();
        console.error(msg);
        alert("Erro ao chamar backend");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setAvailableModels(data);
      console.log(data)
    } catch {
      console.error("Erro ao carregar modelos");
    }
  }


  function moveToUsingModels(model: string) {
    if (!availableModels.includes(model) || usingModels.includes(model)) return;

    setAvailableModels(prev => prev.filter(m => m !== model));
    setUsingModels(prev => [...prev, model]);
  }

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function buildDownloadName(r: StepResult): string {
    const modelSafe = r.model.replace(/\//g, "_");
    const temp = r.temperature ?? temperature;
    const parts = [caseId || `step-${stepIndex}`, r.profile];
    if (r.runIndex != null && r.runIndex >= 1) {
      parts.push(`run-${String(r.runIndex).padStart(3, "0")}`);
    }
    parts.push(`temp-${temp}`, modelSafe, "response.json");
    return parts.join("-");
  }

  async function loadFinalCases() {
    try {
      const qs = new URLSearchParams({ domain });
      if (testNumber != null) qs.set("testNumber", String(testNumber));
      if (testVersion.trim()) qs.set("testVersion", testVersion.trim());
      const res = await fetch(`${API_BASE_URL}/tests/final/cases?${qs}`);
      if (!res.ok) {
        alert("Falha ao listar casos Final");
        return;
      }
      const data = await res.json();
      setFinalCases(data.cases ?? []);
      if (data.cases?.length) {
        setSelectedFinalCaseId(data.cases[0].caseId);
        setCaseId(data.cases[0].caseId);
      }
    } catch (e) {
      console.error(e);
      alert(String(e));
    }
  }

  async function handleRunFinalCase(useBatch = false) {
    try {
      setLoading(true);
      const baseBody = {
        domain,
        caseId: selectedFinalCaseId || caseId || undefined,
        testNumber,
        testVersion: testVersion || undefined,
        imagePath: imagePath.trim() || undefined,
        objective:
          objective.trim() ||
          "Inventariar todos os componentes visíveis na interface.",
        models: usingModels,
        LLMAPI: LLMAPI === "NVIDIA" ? "GEMINI" : LLMAPI,
        profiles,
        temperature,
        includeUiJson: false,
        saveToDisk,
        sessionId,
      };

      const isBatch =
        useBatch ||
        runsPerVersion > 1 ||
        batchPromptVersions.length > 1;

      const body = isBatch
        ? {
            ...baseBody,
            promptVersions: batchPromptVersions,
            runsPerVersion,
          }
        : {
            ...baseBody,
            promptVersion,
            runsPerVersion: 1,
          };

      const endpoint = isBatch
        ? `${API_BASE_URL}/tests/final/run-batch`
        : `${API_BASE_URL}/tests/final/run`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const msg = await res.text();
        console.error(msg);
        alert(`Erro no teste Final: ${msg}`);
        setLoading(false);
        return;
      }

      const data = await res.json();
      if (data.case?.caseId) {
        setCaseId(data.case.caseId);
        if (data.case.testNumber != null) setTestNumber(data.case.testNumber);
        if (data.case.testVersion != null) setTestVersion(data.case.testVersion);
      }

      let enriched: StepResult[] = [];

      if (Array.isArray(data.runs)) {
        for (const batchRun of data.runs) {
          for (const r of batchRun.results ?? []) {
            const uiComponents = r.ui
              ? Array.isArray(r.ui)
                ? r.ui
                : null
              : parseUiFromRaw(r.rawResponse);
            enriched.push({
              ...r,
              promptVersion: batchRun.promptVersion ?? r.promptVersion,
              runIndex: batchRun.runIndex ?? r.runIndex,
              execId: batchRun.execId ?? r.execId,
              ui: uiComponents,
            });
          }
        }
        alert(
          `Batch concluído: ${data.totalRequests ?? enriched.length} requisições (${data.runsPerVersion ?? runsPerVersion} × ${(data.promptVersions ?? batchPromptVersions).join(", ")})`,
        );
      } else {
        enriched = (data.results ?? []).map((r: StepResult) => {
          const uiComponents = r.ui
            ? Array.isArray(r.ui)
              ? r.ui
              : null
            : parseUiFromRaw(r.rawResponse);
          return { ...r, ui: uiComponents };
        });
      }

      setResponses(enriched);
      setSelectedIndex(enriched.length > 0 ? 0 : null);
      setLoading(false);
    } catch (err) {
      console.error(err);
      alert(String(err));
      setLoading(false);
    }
  }

  async function handleSend() {
    try {
      setLoading(true);

      let imageBase64: string | undefined;
      if (imageFile) {
        const dataUrl = await fileToBase64(imageFile);
        imageBase64 = dataUrl;
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
        models: usingModels,
        objective,
        stepIndex,
        imageBase64,
        uiJson,
        profiles,
        LLMAPI,
        temperature,
        promptVersion,
        saveToDisk,
        domain,
        caseId: caseId || `step-${stepIndex}`,
        testNumber,
        testVersion: testVersion || null,
      };

      let res: Response;
      if (LLMAPI === "NVIDIA") {
        res = await fetch(`${API_BASE_URL}/analisysNvidia`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64 }),
        });
      } else {
        res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/steps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const msg = await res.text();
        console.error(msg);
        alert("Erro ao chamar backend");
        setLoading(false);
        return;
      }

      if (LLMAPI === "NVIDIA") {
        const data: NvidiaApiResult = await res.json();
        console.log("Resposta NVIDIA:", data);

        const first = data.detections.data[0];
        const boxes = first?.bounding_boxes ?? {};

        const syntheticResult: StepResult = {
          profile: "AnalisysComponentsLLM",
          model: "nvidia/nemoretriever-page-elements-v3",
          action: "Detecção de elementos de página concluída.",
          rationale: JSON.stringify(boxes, null, 2),
          confidence: 100,
          temperature,
          promptVersion,
          ui: null,
          rawResponse: data,
        };

        setResponses([syntheticResult]);
        setSelectedIndex(0);
      } else {
        const data: ApiResult = await res.json();
        console.log("Resposta da API:", data);

        const enriched: StepResult[] = data.results.map((r) => {
          const uiComponents = Array.isArray(r.ui)
            ? r.ui
            : parseUiFromRaw(r.rawResponse);
          return {
            ...r,
            ui: uiComponents,
          };
        });

        setResponses(enriched);
        setSelectedIndex(enriched.length > 0 ? 0 : null);
      }

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

    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...current,
            temperature: current.temperature ?? temperature,
            promptVersion:
              current.profile === "AnalisysComponentsLLM"
                ? current.promptVersion ?? promptVersion
                : undefined,
            domain,
            caseId,
            testNumber,
            testVersion,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildDownloadName(current);
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

  function handleRemoveUsingModel(model: string) {
    setUsingModels(prev => prev.filter(m => m !== model));
    setAvailableModels(prev => [...prev, model]); 
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
            {/* Perfis */}
            <div className="panel-section">
              <h3 className="section-title">SERVIÇO</h3>
              <select
                value={LLMAPI}
                onChange={e => setLLMAPI(e.target.value as LLMAPIType)}
                className="input-field"
              >

                <option value="GEMINI">GEMINI</option>
                <option value="OPENROUTER">OPENROUTER</option>
                <option value="NVIDIA">NVIDIA</option>
              </select>
            </div>

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

            <label className="input-group">
              <span className="input-label">Temperature</span>
              <input
                type="number"
                step="0.1"
                min={0}
                max={2}
                value={temperature}
                onChange={e => setTemperature(Number(e.target.value))}
                className="input-field"
              />
            </label>

            <label className="input-group">
              <span className="input-label">Prompt Analysis (versão)</span>
              <select
                value={promptVersion}
                onChange={e => setPromptVersion(e.target.value)}
                className="input-field"
              >
                {promptVersions.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>

            <label className="checkbox-item" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={saveToDisk}
                onChange={e => setSaveToDisk(e.target.checked)}
                className="checkbox-input"
              />
              <span className="checkbox-label">Salvar em results/ (prompt + temp no nome)</span>
            </label>
          </div>

          <div className="panel-section">
            <h3 className="section-title">📁 Teste em lote (1 imagem → N × versões)</h3>
            <label className="input-group">
              <span className="input-label">Caminho da imagem</span>
              <input
                value={imagePath}
                onChange={e => setImagePath(e.target.value)}
                placeholder="Final/LibreOffice/resized1920X1080/1v0a.png"
                className="input-field"
              />
            </label>
            <label className="input-group">
              <span className="input-label">Repetições por versão (N)</span>
              <input
                type="number"
                min={1}
                max={50}
                value={runsPerVersion}
                onChange={e => setRunsPerVersion(Math.max(1, Number(e.target.value) || 1))}
                className="input-field"
              />
            </label>
            <div className="panel-section" style={{ padding: 0 }}>
              <span className="input-label">Versões de prompt (batch)</span>
              <div className="profiles-list">
                {promptVersions.map(v => (
                  <label key={`batch-${v}`} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={batchPromptVersions.includes(v)}
                      onChange={e => {
                        if (e.target.checked) {
                          setBatchPromptVersions(prev =>
                            prev.includes(v) ? prev : [...prev, v],
                          );
                        } else {
                          setBatchPromptVersions(prev =>
                            prev.filter(x => x !== v),
                          );
                        }
                      }}
                      className="checkbox-input"
                    />
                    <span className="checkbox-label">{v}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="panel-section">
            <h3 className="section-title">📁 Caso Final (nº + versão)</h3>
            <label className="input-group">
              <span className="input-label">Domínio</span>
              <select
                value={domain}
                onChange={e => setDomain(e.target.value as FinalDomain)}
                className="input-field"
              >
                <option value="Americanas">Americanas</option>
                <option value="Limeira">Limeira</option>
                <option value="LibreOffice">LibreOffice</option>
              </select>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <label className="input-group" style={{ flex: 1 }}>
                <span className="input-label">Número</span>
                <input
                  type="number"
                  min={0}
                  value={testNumber}
                  onChange={e => setTestNumber(Number(e.target.value) || 0)}
                  className="input-field"
                />
              </label>
              <label className="input-group" style={{ flex: 1 }}>
                <span className="input-label">Versão</span>
                <input
                  value={testVersion}
                  onChange={e => setTestVersion(e.target.value)}
                  placeholder="v0a"
                  className="input-field"
                />
              </label>
            </div>
            <label className="input-group">
              <span className="input-label">caseId</span>
              <input
                value={caseId}
                onChange={e => setCaseId(e.target.value)}
                placeholder="1v0a"
                className="input-field"
              />
            </label>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn-secondary" onClick={loadFinalCases}>
                Listar Final
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleRunFinalCase(false)}
                disabled={loading || !usingModels.length}
              >
                Rodar 1×
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleRunFinalCase(true)}
                disabled={
                  loading ||
                  !usingModels.length ||
                  batchPromptVersions.length === 0
                }
              >
                Batch N×versões
              </button>
            </div>
            {finalCases.length > 0 && (
              <label className="input-group">
                <span className="input-label">Caso encontrado</span>
                <select
                  value={selectedFinalCaseId}
                  onChange={e => {
                    setSelectedFinalCaseId(e.target.value);
                    setCaseId(e.target.value);
                    const c = finalCases.find(x => x.caseId === e.target.value);
                    if (c?.testNumber != null) setTestNumber(c.testNumber);
                    if (c?.testVersion != null) setTestVersion(c.testVersion);
                  }}
                  className="input-field"
                >
                  {finalCases.map(c => (
                    <option key={`${c.domain}-${c.caseId}`} value={c.caseId}>
                      {c.caseId} (n={c.testNumber ?? "-"}{c.testVersion ?? ""})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* NOVO: Modelos Disponíveis (EPI) - EM CIMA */}
          {availableModels?.length > 0 ? (
            <div className="panel-section">
              <div className="section-header">
                <h3 className="section-title">📦 Modelos Disponíveis (API)</h3>
                <span className="badge">{availableModels.length}</span>
              </div>

              <ul className="models-list">
                {availableModels.map(m => (
                  <li key={m} className="model-item available">
                    <span className="model-name">{m}</span>
                    <button
                      onClick={() => moveToUsingModels(m)}
                      className="btn-add-small"
                      title="Adicionar aos modelos utilizando"
                    >
                      +
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (<br></br>)}


          {/* Modelos Utilizando */}
          <div className="panel-section">
            <div className="section-header">
              <h3 className="section-title">🎯 Modelos Utilizando</h3>
              <span className="badge">{usingModels.length}</span>
            </div>

            <ul className="models-list">
              {usingModels.map(m => (
                <li key={m} className="model-item using">
                  <span className="model-name">{m}</span>
                  <button
                    onClick={() => handleRemoveUsingModel(m)}
                    className="btn-remove"
                    aria-label="Remover modelo"
                    title="Remover dos utilizando (volta para disponíveis)"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            {/* <div className="add-model-row">
              <input
                value={newModel}
                onChange={e => setNewModel(e.target.value)}
                placeholder="Novo modelo manual..."
                className="input-field"
                onKeyPress={e => {
                  if (e.key === "Enter") {
                    const trimmed = newModel.trim();
                    if (trimmed && !availableModels.includes(trimmed) && !usingModels.includes(trimmed)) {
                      setAvailableModels(prev => [...prev, trimmed]);
                      setNewModel("");
                    }
                  }
                }}
              />
              <button
                onClick={() => {
                  const trimmed = newModel.trim();
                  if (!trimmed) return;
                  if (!availableModels.includes(trimmed) && !usingModels.includes(trimmed)) {
                    setAvailableModels(prev => [...prev, trimmed]);
                  }
                  setNewModel("");
                }}
                className="btn-add"
              >
                +
              </button>
            </div> */}
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

        {/* Painel de Resultados - continua igual */}
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
                  <div className="meta-card">
                    <span className="meta-label">Temperature</span>
                    <span className="meta-value">{current.temperature ?? temperature}</span>
                  </div>
                  {current.profile === "AnalisysComponentsLLM" && (
                    <div className="meta-card">
                      <span className="meta-label">Prompt Analysis</span>
                      <span className="meta-value">{current.promptVersion ?? promptVersion}</span>
                    </div>
                  )}
                  {current.runIndex != null && current.runIndex >= 1 && (
                    <div className="meta-card">
                      <span className="meta-label">Run</span>
                      <span className="meta-value">#{current.runIndex}</span>
                    </div>
                  )}
                  {current.execId != null && (
                    <div className="meta-card">
                      <span className="meta-label">Execução</span>
                      <span className="meta-value">exec{current.execId}</span>
                    </div>
                  )}
                  {current.savedPath && (
                    <div className="meta-card">
                      <span className="meta-label">Salvo em</span>
                      <span className="meta-value" title={current.savedPath}>
                        {current.savedPath.split(/[/\\]/).slice(-4).join("/")}
                      </span>
                    </div>
                  )}
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
                if (e.key === "Enter" && !loading && objective.trim() && usingModels.length) {
                  handleSend();
                }
              }}
            />
            <button
              onClick={handleSend}
              disabled={loading || !objective.trim() || !usingModels.length}
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
