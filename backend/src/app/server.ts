// app/server.ts
import Fastify from 'fastify';
import { buildContainer } from '../config/di-container';
import fastifyCors from "@fastify/cors";
import 'dotenv/config'
import { StepController } from '../core/controllers/LLMController';
import { AnalisisLLM } from '../core/services/llm/AnalisisLLM';
import { GoogleLLMClient } from '../core/services/llm/GoogleService';
import { GuideStep } from '../core/services/llm/GuideStepLLM';
import { OpenRouterLLMClient } from '../core/services/llm/OpenRouterService';
import { MODELOS_DISPONIVEIS } from '../core/services/llm/LLMModesAvaible';
import { NvidiaObjectDetectionService } from '../core/services/llm/nvidia/NvidiaService';
import { NvidiaDetectionController } from '../core/controllers/NvidiaController';


const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024, });

app.register(fastifyCors, {
  origin: true, // ou "http://localhost:5173" se quiser travar
});

const { stepController } = buildContainer();


type LLMAPI = "OPENROUTER" | "GEMINI"

const llmClientMap: Record<LLMAPI, any> = {
  OPENROUTER: new OpenRouterLLMClient(),
  GEMINI: new GoogleLLMClient(),
};

app.get('/openrouter/models', (req,res) => {
  res.send(MODELOS_DISPONIVEIS);
})

app.post('/sessions/:sessionId/steps', (req, res) => {
  const { LLMAPI } = req.body as { LLMAPI: LLMAPI };

  const llmClient = llmClientMap[LLMAPI];

  const analysisService = new AnalisisLLM(llmClient);
  const guideService = new GuideStep(llmClient);
  const cognitiveService = new AnalisisLLM(llmClient);

  const stepController = new StepController({ 
    AnalisysComponentsLLM: analysisService,
    GuideLLM: guideService,
    CongnitiveWalktroughLLM: cognitiveService,
  });

  return stepController.createHandler(req,res)
});

app.post('/analisysNvidia', (req, res) => {
  console.log("pong")
  const nvidiaAnalisysController = new NvidiaDetectionController(new NvidiaObjectDetectionService); 

  return nvidiaAnalisysController.detectHandler(req, res);
})

const PORT = Number(process.env.PORT) || 3000;

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then((address) => {
    console.log(`🚀 Fastify rodando em ${address}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });