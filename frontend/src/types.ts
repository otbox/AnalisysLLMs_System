// types.ts
export type Theme    = "light" | "dark";
export type ResultTab = "clean" | "full" | "output" | "annotated";
export type InputTab  = "single" | "batch";

// Deve bater com as chaves do StepController no server.ts
export type ProfileKey =
  | "AnalisysComponentsLLM"
  | "CongnitiveWalktroughLLM"
  | "GuideLLM"
  | "annotation";

// Cliente de IA passado no body da requisição
export type LLMAPI = "GEMINI" | "OPENROUTER" |  "OLLAMA";

export interface UiElement {
  id?:          string;
  type?:        string;
  text?:        string | null;
  region?:      string;
  coordenadas:  number[] | { x: number; y: number; w: number; h: number };
  state?:       string;
  actions?:     string[];
  color?:       string;
  meta?:        Record<string, unknown>;
}

export interface LLMError {
  type:      "quota_exceeded" | "rate_limit" | "auth" | "unknown";
  message:   string;
  retryable: boolean;
}

export interface JobResult {
  profile:  ProfileKey;
  model:    string;
  status:   "success" | "error";
  output?:  unknown;
  full?:    UiElement[];
  clean?:   UiElement[];
  error?:   LLMError;
}

export interface StepResponse {
  sessionId:  string;
  stepIndex:  number;
  objective:  string;
  results:    JobResult[];
}

export interface QueueItem {
  id:           string;
  fileName:     string;
  imageBase64:  string;
  status:       "pending" | "running" | "done" | "error";
  response?:    StepResponse;
  error?:       string;
}

export interface ProfileConfig {
  key:              ProfileKey;
  label:            string;
  emoji:            string;
  defaultObjective: string;
  color:            "blue" | "purple" | "green";
}

export const PROFILE_CONFIGS: ProfileConfig[] = [
  {
    key:              "AnalisysComponentsLLM",
    label:            "Análise de Componentes",
    emoji:            "🧱",
    defaultObjective: "Identifique todos os componentes de UI visíveis na interface.",
    color:            "blue",
  },
  {
    key:              "CongnitiveWalktroughLLM",
    label:            "Cognitive Walkthrough",
    emoji:            "🧠",
    defaultObjective: "Realize um walkthrough cognitivo identificando fluxos de tarefa, pontos de confusão e problemas de usabilidade.",
    color:            "purple",
  },
  {
    key:              "GuideLLM",
    label:            "Guide",
    emoji:            "📖",
    defaultObjective: "Gere um guia passo a passo descrevendo como usar a interface apresentada.",
    color:            "green",
  },
  {
    key:              "annotation",
    label:            "Anotação manual",
    emoji:            "🖊️",
    defaultObjective: "Gere um guia passo a passo descrevendo como usar a interface apresentada.",
    color:            "green",
  }
];

// Modelos agrupados por serviço (LLMAPI)
export const MODEL_GROUPS: Record<LLMAPI, string[]> = {
  GEMINI: [
    "gemini-2.5-flash",
  ],
  OPENROUTER: [
    // "google/gemma-3-12b-it:free",
    // "meta-llama/llama-3.2-11b-vision-instruct:free",
    // "qwen/qwen2.5-vl-72b-instruct:free",
  ],
  OLLAMA : [
    "qwen3-vl",
    "llava"
  ]
};

export const AVAILABLE_MODELS = [
  ...MODEL_GROUPS.GEMINI,
  ...MODEL_GROUPS.OPENROUTER,
  ...MODEL_GROUPS.OLLAMA
];
