// config/di-container.ts

import { StepController } from "../core/controllers/LLMController";
import { AnalisisLLM } from "../core/services/llm/AnalisisLLM";
import { GoogleLLMClient } from "../core/services/llm/GoogleService";
import { GuideStep } from "../core/services/llm/GuideStepLLM";
import { OpenRouterLLMClient } from "../core/services/llm/OpenRouterService";
import { QueueService } from "../core/services/QueueService";

export function buildContainer() {
  const llmClient = new OpenRouterLLMClient();

  const analysisService = new AnalisisLLM(llmClient);
  const guideService = new GuideStep(llmClient);
  const cognitiveService = new AnalisisLLM(llmClient);
  const queueService = new QueueService(analysisService, 1);

  const stepController = new StepController(
    {
      AnalisysComponentsLLM: analysisService,
      GuideLLM: guideService,
      CongnitiveWalktroughLLM: cognitiveService,
    },
    queueService,
  );

  return {
    stepController,
  };
}
