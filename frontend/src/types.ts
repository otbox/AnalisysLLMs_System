// types.ts
export type Theme     = "light" | "dark";
export type ResultTab = "clean" | "full" | "output" | "annotated";
export type InputTab  = "single" | "batch";

// Must match the profile keys registered in the backend StepController.
export type ProfileKey =
  | "AnalisysComponentsLLM"
  | "CongnitiveWalktroughLLM"
  | "GuideLLM"
  | "annotation"
  | "nemotron";

export type LLMAPI = "GEMINI" | "OPENROUTER" | "OLLAMA";

export interface UiElement {
  id?:         string;
  type?:       string;
  text?:       string | null;
  region?:     string;
  coordenadas: number[] | { x: number; y: number; w: number; h: number };
  state?:      string;
  actions?:    string[];
  color?:      string;
  meta?:       Record<string, unknown>;
}

export interface LLMError {
  type:      "quota_exceeded" | "rate_limit" | "auth" | "unknown";
  message:   string;
  retryable: boolean;
}

export interface JobResult {
  profile: ProfileKey;
  model:   string;
  status:  "success" | "error";
  output?: unknown;
  full?:   UiElement[];
  clean?:  UiElement[];
  error?:  LLMError;
}

export interface StepResponse {
  sessionId: string;
  stepIndex: number;
  objective: string;
  results:   JobResult[];
}

export interface QueueItem {
  id:          string;
  fileName:    string;
  imageBase64: string;
  status:      "pending" | "running" | "done" | "error";
  response?:   StepResponse;
  error?:      string;
}

export interface ProfileConfig {
  key:              ProfileKey;
  label:            string;
  emoji:            string;
  defaultObjective: string;
  color:            "blue" | "purple" | "green" | "orange";
}

export const PROFILE_CONFIGS: ProfileConfig[] = [
  {
    key:              "AnalisysComponentsLLM",
    label:            "Component Analysis",
    emoji:            "🧱",
    defaultObjective: "Identify all visible UI components in the interface.",
    color:            "blue",
  },
  {
    key:              "CongnitiveWalktroughLLM",
    label:            "Cognitive Walkthrough",
    emoji:            "🧠",
    defaultObjective: "Perform a cognitive walkthrough identifying task flows, points of confusion, and usability issues.",
    color:            "purple",
  },
  {
    key:              "GuideLLM",
    label:            "Guide",
    emoji:            "📖",
    defaultObjective: "Generate a step-by-step guide describing how to use the presented interface.",
    color:            "green",
  },
  {
    key:              "annotation",
    label:            "Annotator",
    emoji:            "🖊️",
    defaultObjective: "",
    color:            "orange",
  },
  {
    key:              "nemotron",
    label:            "Nemotron",
    emoji:            "🟩",
    defaultObjective: "",
    color:            "green",
  },
];

export const MODEL_GROUPS: Record<LLMAPI, string[]> = {
  GEMINI: [
    "gemini-2.5-flash",
  ],
  OPENROUTER: [],
  OLLAMA: [
    "qwen3-vl",
    "llava",
  ],
};

export const AVAILABLE_MODELS = [
  ...MODEL_GROUPS.GEMINI,
  ...MODEL_GROUPS.OPENROUTER,
  ...MODEL_GROUPS.OLLAMA,
];
