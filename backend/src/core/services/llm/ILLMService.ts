import {
  AnalisysPromptVersion,
  DEFAULT_ANALISYS_PROMPT_VERSION,
  ProfileKey,
} from "./LLMsProfiles";

export const DEFAULT_TEMPERATURE = 0.2;

export type StepModelInput = {
  model: string;
  profile: ProfileKey;
  objective: string;
  stepIndex: number;
  historySummary?: string;
  uiJson?: string;
  imageBase64?: string;
  /** Temperatura de geração (default 0.2). */
  temperature?: number;
  /** Versão do prompt AnalisysComponentsLLM (ignorada nos outros perfis). */
  promptVersion?: AnalisysPromptVersion;
};

export type StepModelOutput = {
  action: string;
  rationale: string;
  confidence: number;
  rawResponse: unknown;
  temperature: number;
  promptVersion?: AnalisysPromptVersion;
};

export interface LLMClient {
  callStep(input: StepModelInput, signal?: AbortSignal): Promise<StepModelOutput>;
}

export interface ILLMService {
  callModel(input: StepModelInput): Promise<StepModelOutput>;
}

export function resolveTemperature(value?: number): number {
  if (value == null || Number.isNaN(value)) return DEFAULT_TEMPERATURE;
  return Math.min(2, Math.max(0, value));
}

export function resolvePromptVersion(
  profile: ProfileKey,
  version?: AnalisysPromptVersion,
): AnalisysPromptVersion | undefined {
  if (profile !== "AnalisysComponentsLLM") return undefined;
  return version ?? DEFAULT_ANALISYS_PROMPT_VERSION;
}
