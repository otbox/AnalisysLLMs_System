export type ModelsAvaibleKey =
  | "allenai/molmo-2-8b:free"
  | "nvidia/nemotron-nano-12b-v2-vl:free"
  | "mistralai/mistral-small-3.1-24b-instruct:free"
  | "google/gemma-3-4b-it:free"
  | "google/gemma-3-12b-it:free"
  | "google/gemma-3-27b-it:free"
  | "qwen/qwen-2.5-vl-7b-instruct:free";

export const MODELOS_DISPONIVEIS: ModelsAvaibleKey[] = [
  // "allenai/molmo-2-8b:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  // "google/gemma-3-4b-it:free",
  // "google/gemma-3-12b-it:free",
  // "google/gemma-3-27b-it:free",
  // "qwen/qwen-2.5-vl-7b-instruct:free",
] as const;