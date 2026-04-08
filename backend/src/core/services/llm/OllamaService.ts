// OllamaService.ts
import { LLMClient, StepModelInput, StepModelOutput } from './ILLMService';
import { ProfileKey, Profiles } from './LLMsProfiles';
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const RESPONSES_DIR = path.resolve('output', 'ollama_responses');

function saveResponses(params: {
  profile: string;
  model: string;
  stepIndex: number;
  rawContent: string;
  parsed: unknown;
}): void {
  try {
    const { profile, model, stepIndex, rawContent, parsed } = params;

    const safeModel = model.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(
      RESPONSES_DIR,
      `${profile}-${safeModel}`,
      `step${stepIndex}_${timestamp}`,
    );

    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, 'raw_response.json'),
      rawContent,
      'utf-8',
    );

    fs.writeFileSync(
      path.join(dir, 'parsed.json'),
      JSON.stringify(parsed, null, 2),
      'utf-8',
    );

    console.log(`[OllamaService] 💾 resposta salva em ${dir}`);
  } catch (err) {
    console.warn(
      '[OllamaService] saveResponses falhou:',
      (err as Error).message,
    );
  }
}

export class OllamaLLMClient implements LLMClient {
  constructor() {}

  async callStep(input: StepModelInput, signal?: AbortSignal): Promise<StepModelOutput> {
    console.log('Calling Ollama');

    const systemPrompt =
      Profiles[input.profile] ?? Profiles['AnalisysComponentsLLM'];

    const userText = buildUserText(input);

    const body: any = {
      model: input.model ?? 'llama3', // ou o nome do modelo que você rodar no Ollama
      stream: false,
      format: 'json', // força resposta em JSON
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    };

    // Se quiser mandar imagem como base64 + instrução no texto:
    // o Ollama não tem o mesmo esquema multimodal de Gemini,
    // então normalmente você referencia a imagem no prompt
    // ou usa um modelo que aceite "images" no body, dependendo da config.

    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama error: ${res.status} ${msg}`);
    }

    const json: any = await res.json();
    const rawContent: string = json.message?.content ?? '';
    const parsed = safeParseJson(rawContent);

    saveResponses({
      profile: input.profile,
      model: input.model ?? 'ollama-local',
      stepIndex: input.stepIndex,
      rawContent,
      parsed,
    });

    // Adapte aqui exatamente igual ao GoogleService
    if (input.profile === 'AnalisysComponentsLLM' && input.imageBase64) {
      return {
        action: parsed.action ?? '',
        rationale: parsed.rationale ?? '',
        numberOfComponents: parsed.length,
        confidence: parsed.confidence ?? 0,
        rawResponse: json,
      };
    }

    return {
      action: parsed.action ?? '',
      rationale: parsed.rationale ?? '',
      confidence: parsed.confidence ?? 0,
      rawResponse: json,
    };
  }
}

function buildUserText(input: StepModelInput): string {
  const parts: string[] = [];
  parts.push(`Objetivo do Usuário: ${input.objective}`);
  parts.push(`Passo atual do percurso: ${input.stepIndex}`);

  if (input.historySummary) {
    parts.push(`Resumo dos passos anteriores: ${input.historySummary}`);
  }

  if (input.uiJson) {
    parts.push(
      `Elementos da interface em JSON (use se ajudar, não precisa repetir tudo):\n${input.uiJson}`,
    );
  }

  if (input.profile !== 'AnalisysComponentsLLM') {
    parts.push(
      [
        'Responda APENAS em JSON com os campos:',
        ' - action: string, próxima acção concreta do usuário;',
        ' - rationale: string, explicação da escolha;',
        ' - confidence: inteiro de 0 a 100, representando a confiança em %.',
      ].join('\n'),
    );
  }

  return parts.join('\n\n');
}

function safeParseJson(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}