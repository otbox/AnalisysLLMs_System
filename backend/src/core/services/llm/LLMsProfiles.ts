// LLMsProfiles.ts
// Maps each profile key to the prompt TEMPLATE string.
// GoogleService and OllamaService call interpolatePrompt() at request time
// to inject {{IMAGE_WIDTH}} and {{IMAGE_HEIGHT}} (and any other vars).
import {
  v8,
  v6pixels,
  v5scale,
  v9,
} from "./profiles/AnalisysProfiles";

export type ProfileKey =
  | "AnalisysComponentsLLM"
  | "CongnitiveWalktroughLLM"
  | "GuideLLM";

/**
 * Raw prompt templates.  Tokens like {{IMAGE_WIDTH}} are NOT yet resolved.
 * Call `interpolatePrompt(Profiles[key], vars)` before sending to the model.
 */
export const Profiles: Record<ProfileKey, string> = {
  // Primary component-analysis profile — absolute pixels, dimensions injected
  AnalisysComponentsLLM: v9,

  // Cognitive walkthrough — normalised coords, no image-size dependency
  CongnitiveWalktroughLLM: v8,

  // Guide generation — normalised coords
  GuideLLM: v8,
};

/** Versões de teste batch (mapeiam para templates em AnalisysProfiles). */
export type AnalisysPromptVersion = "v1" | "v2" | "v3";

export const DEFAULT_ANALISYS_PROMPT_VERSION: AnalisysPromptVersion = "v1";

export const ANALISYS_PROMPT_VERSIONS: AnalisysPromptVersion[] = [
  "v1",
  "v2",
  "v3",
];

const ANALISYS_BY_VERSION: Record<AnalisysPromptVersion, string> = {
  v1: v9,
  v2: v6pixels,
  v3: v5scale,
};

export function resolveAnalisysPrompt(
  version: AnalisysPromptVersion = DEFAULT_ANALISYS_PROMPT_VERSION,
): string {
  const prompt = ANALISYS_BY_VERSION[version];
  if (!prompt) {
    throw new Error(
      `Versão de prompt desconhecida: ${version}. ` +
        `Disponíveis: ${ANALISYS_PROMPT_VERSIONS.join(", ")}`,
    );
  }
  return prompt;
}
