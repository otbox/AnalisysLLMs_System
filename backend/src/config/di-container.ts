// config/di-container.ts

import { StepController } from "../core/controllers/LLMController";
import { AnalisisLLM } from "../core/services/llm/AnalisisLLM";
import { GoogleLLMClient } from "../core/services/llm/GoogleService";
import { GuideStep } from "../core/services/llm/GuideStepLLM";
import { OpenRouterLLMClient } from "../core/services/llm/LLMClient";

export function buildContainer() {
  const llmClient = new OpenRouterLLMClient();
  const geminiClient = new GoogleLLMClient();

  const analysisService = new AnalisisLLM(geminiClient);
  const guideService = new GuideStep(llmClient);
  const cognitiveService = new AnalisisLLM(llmClient);

  const stepController = new StepController({
    AnalisysComponentsLLM: analysisService,
    GuideLLM: guideService,
    CongnitiveWalktroughLLM: cognitiveService,
  });

  return {
    stepController,
  };
}
