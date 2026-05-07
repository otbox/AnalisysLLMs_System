// LLMsProfiles.ts
// Maps each profile key to the prompt TEMPLATE string.
// GoogleService and OllamaService call interpolatePrompt() at request time
// to inject {{IMAGE_WIDTH}} and {{IMAGE_HEIGHT}} (and any other vars).
import {
  v8,
  v6pixels,
  v5scale,
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
  AnalisysComponentsLLM: v6pixels,

  // Cognitive walkthrough — normalised coords, no image-size dependency
  CongnitiveWalktroughLLM: v8,

  // Guide generation — normalised coords
  GuideLLM: v8,
};
