import { UiElement } from "../ImageAnnotation";
import {
  AnalisysPromptVersion,
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
  temperature?: number;
  /** Versão do template AnalisysComponentsLLM (batch Final/). */
  promptVersion?: AnalisysPromptVersion;
};

export function resolveTemperature(value?: number): number {
  if (value == null || Number.isNaN(value)) return DEFAULT_TEMPERATURE;
  return Math.min(2, Math.max(0, value));
}

export type StepModelOutput = {
    action: string,
    rationale: string,
    numberOfComponents?: Number,
    imageOutputBase64?: string,
    confidence: number,
    rawResponse: unknown,
}

export interface CallModelResult {
    output: StepModelOutput;
    full: UiElement[];
    clean: UiElement[];
}

export interface LLMClient {
    callStep(input: StepModelInput, signal?: AbortSignal): Promise<StepModelOutput>;
}

export interface ILLMService {
    callModel(
        params: StepModelInput,
        idsToRemove?: string[]
    ): Promise<CallModelResult | StepModelOutput>;
}
