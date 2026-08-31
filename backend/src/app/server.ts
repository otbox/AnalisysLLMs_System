// app/server.ts
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import "dotenv/config";
import { StepController } from "../core/controllers/LLMController";
import { AnalisisLLM } from "../core/services/llm/AnalisisLLM";
import { GoogleLLMClient } from "../core/services/llm/GoogleService";
import { GuideStep } from "../core/services/llm/GuideStepLLM";
import { OpenRouterLLMClient } from "../core/services/llm/OpenRouterService";
import { MODELOS_DISPONIVEIS } from "../core/services/llm/LLMModesAvaible";
import { NvidiaObjectDetectionService } from "../core/services/llm/nvidia/NvidiaService";
import { NvidiaDetectionController } from "../core/controllers/NvidiaController";
import { FinalTestController } from "../core/controllers/FinalTestController";
import {
  ANALISYS_PROMPT_VERSIONS,
  DEFAULT_ANALISYS_PROMPT_VERSION,
} from "../core/services/llm/LLMsProfiles";
import { DEFAULT_TEMPERATURE } from "../core/services/llm/ILLMService";

const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });

app.register(fastifyCors, {
  origin: true,
});

const finalTestController = new FinalTestController();

type LLMAPI = "OPENROUTER" | "GEMINI";

function getLlmClient(api: LLMAPI) {
  if (api === "GEMINI") return new GoogleLLMClient();
  return new OpenRouterLLMClient();
}

app.get("/openrouter/models", (_req, res) => {
  res.send(MODELOS_DISPONIVEIS);
});

app.get("/meta/analisys-prompts", (_req, res) => {
  res.send({
    defaultVersion: DEFAULT_ANALISYS_PROMPT_VERSION,
    versions: ANALISYS_PROMPT_VERSIONS,
    defaultTemperature: DEFAULT_TEMPERATURE,
  });
});

app.get("/tests/final/cases", (req, res) =>
  finalTestController.listHandler(req, res),
);

app.post("/tests/final/run", (req, res) =>
  finalTestController.runHandler(req, res),
);

app.post("/tests/final/run-batch", (req, res) =>
  finalTestController.batchHandler(req, res),
);

app.post("/sessions/:sessionId/steps", (req, res) => {
  const { LLMAPI } = req.body as { LLMAPI: LLMAPI };

  const llmClient = getLlmClient(LLMAPI);

  const analysisService = new AnalisisLLM(llmClient);
  const guideService = new GuideStep(llmClient);
  const cognitiveService = new AnalisisLLM(llmClient);

  const controller = new StepController({
    AnalisysComponentsLLM: analysisService,
    GuideLLM: guideService,
    CongnitiveWalktroughLLM: cognitiveService,
  });

  return controller.createHandler(req, res);
});

app.post("/analisysNvidia", (req, res) => {
  const nvidiaAnalisysController = new NvidiaDetectionController(
    new NvidiaObjectDetectionService(),
  );

  return nvidiaAnalisysController.detectHandler(req, res);
});

const PORT = Number(process.env.PORT) || 3000;

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then((address) => {
    console.log(`🚀 Fastify rodando em ${address}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
