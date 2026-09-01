// LLMsProfiles.ts
// Maps each profile key to the prompt TEMPLATE string.
// GoogleService and OllamaService call interpolatePrompt() at request time
// to inject {{IMAGE_WIDTH}} and {{IMAGE_HEIGHT}} (and any other vars).
import {
  v1,
  v2,
  v3,
  v3pixels,
  v5pixels,
  v5pixelsold,
  v5scale,
  v5scaleEn,
  v6,
  v6pixels,
  v6pixels_tall,
  v6PixelsEn,
  v8,
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
  AnalisysComponentsLLM: v9,
  CongnitiveWalktroughLLM: v8,
  GuideLLM: v8,
};

/** Todas as versões selecionáveis do AnalisysComponentsLLM (batch / API). */
export const ANALISYS_PROMPT_VERSIONS = [
  "v9",
  "v8",
  "v6pixels",
  "v6pixels_tall",
  "v6PixelsEn",
  "v6",
  "v5scale",
  "v5scaleEn",
  "v5pixels",
  "v5pixelsold",
  "v3pixels",
  "v1",
  "v2",
  "v3",
] as const;

export type AnalisysPromptVersion = (typeof ANALISYS_PROMPT_VERSIONS)[number];

export const DEFAULT_ANALISYS_PROMPT_VERSION: AnalisysPromptVersion = "v9";

const ANALISYS_BY_VERSION: Record<AnalisysPromptVersion, string> = {
  v9: v9,
  v8: v8,
  v6pixels: v6pixels,
  v6pixels_tall: v6pixels_tall,
  v6PixelsEn: v6PixelsEn,
  v6: v6,
  v5scale: v5scale,
  v5scaleEn: v5scaleEn,
  v5pixels: v5pixels,
  v5pixelsold: v5pixelsold,
  v3pixels: v3pixels,
  v1: v1,
  v2: v2,
  v3: v3,
};

export function normalizeAnalisysPromptVersion(
  version: string,
): AnalisysPromptVersion {
  const resolved = version as AnalisysPromptVersion;
  if (!ANALISYS_BY_VERSION[resolved]) {
    throw new Error(
      `Versão de prompt desconhecida: ${version}. ` +
        `Disponíveis: ${ANALISYS_PROMPT_VERSIONS.join(", ")}`,
    );
  }
  return resolved;
}

export function resolveAnalisysPrompt(
  version: string = DEFAULT_ANALISYS_PROMPT_VERSION,
): string {
  const key = normalizeAnalisysPromptVersion(version);
  return ANALISYS_BY_VERSION[key];
}

export function isAnalisysPromptVersion(
  value: string,
): value is AnalisysPromptVersion {
  return (ANALISYS_PROMPT_VERSIONS as readonly string[]).includes(value);
}
