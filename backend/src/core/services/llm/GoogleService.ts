import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { ProfileKey, Profiles } from './LLMsProfiles';
import { LLMClient, StepModelInput, StepModelOutput } from './ILLMService';
import 'dotenv/config';
import * as fs   from 'fs';
import * as path from 'path';
import { LlmImageAnnotatorService } from '../ImageAnnotationScale';


const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
console.log(GOOGLE_API_KEY);

if (!GOOGLE_API_KEY) {
  throw new Error('GOOGLE_API_KEY not defined');
}


const RESPONSES_DIR = path.resolve('output', 'google_responses');

function saveResponses(params: {
  profile:    string;
  model:      string;
  stepIndex:  number;
  rawContent: string;
  parsed:     unknown;
}): void {
  try {
    const { profile, model, stepIndex, rawContent, parsed } = params;

    const safeModel     = model.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const timestamp     = new Date().toISOString().replace(/[:.]/g, '-');
    const dir           = path.join(
      RESPONSES_DIR,
      `${profile}-${safeModel}`,
      `step${stepIndex}_${timestamp}`,
    );

    fs.mkdirSync(dir, { recursive: true });

    // JSON bruto (string devolvida pela API — pode ser inválido, por isso guardamos cru)
    fs.writeFileSync(
      path.join(dir, 'raw_response.json'),
      rawContent,
      'utf-8',
    );

    // JSON já parseado (o objeto que o resto do sistema usa)
    fs.writeFileSync(
      path.join(dir, 'parsed.json'),
      JSON.stringify(parsed, null, 2),
      'utf-8',
    );

    console.log(`[GoogleService] 💾 resposta salva em ${dir}`);
  } catch (err) {
    // Salvar em disco nunca deve quebrar o fluxo principal
    console.warn('[GoogleService] saveResponses falhou:', (err as Error).message);
  }
}

// ────────────────────────────────────────────────────────────────────────────

export class GoogleLLMClient implements LLMClient {
  private readonly client: GoogleGenerativeAI;

  constructor() {
    this.client = new GoogleGenerativeAI(GOOGLE_API_KEY!);
  }

  async callStep(input: StepModelInput, signal?: AbortSignal): Promise<StepModelOutput> {
    console.log('Calling google API');

    const model = this.client.getGenerativeModel({
      // model: 'gemini-2.5-flash-lite',
      model: 'models/gemini-2.5-flash',
      // model: 'models/gemini-2.5-flash-lite',
      // model: 'models/gemini-2.5-pro',
      generationConfig: {
        temperature:      0.2,
        maxOutputTokens:  20000,
        responseMimeType: 'application/json',
      },
    });

    const contents      = buildContents(input);
    const systemPrompt  = Profiles[input.profile] ?? Profiles['AnalisysComponentsLLM'];

    try {
      const result   = await model.generateContent({ contents, systemInstruction: systemPrompt });
      const response = result.response;
      const content  = response.text();
      const parsed   = safeParseJson(content);

      console.log(content);

      // ── Persiste raw + parsed em disco ──────────────────────────────────
      saveResponses({
        profile:    input.profile,
        model:      input.model ?? 'gemini-2.5-flash',
        stepIndex:  input.stepIndex,
        rawContent: content,
        parsed,
      });

      if (input.profile === 'AnalisysComponentsLLM' && input.imageBase64) {
        // const service = new LlmImageAnnotatorService();
        // const detectImage = await service.annotateFromAnalysis({
        //   imageBase64:  input.imageBase64,
        //   analysis:     { ui: parsed },
        //   outputFormat: 'png',
        //   includeLabel: true,
        //   coordScale: "pixels"
        // });

        return {
          action:             parsed.action             ?? '',
          rationale:          parsed.rationale          ?? '',
          numberOfComponents: parsed.length,
          // imageOutputBase64:  detectImage.base64,
          confidence:         parsed.confidence         ?? 0,
          rawResponse:        response,
        };
      }

      return {
        action:      parsed.action      ?? '',
        rationale:   parsed.rationale   ?? '',
        confidence:  parsed.confidence  ?? 0,
        rawResponse: response,
      };

    } catch (error: any) {
      throw new Error(
        'Google AI error: ' + (error.message || JSON.stringify(error)),
      );
    }
  }
}

// ── Helpers de construção de conteúdo ────────────────────────────────────────

function buildContents(input: StepModelInput): Content[] {
  const userText = buildUserText(input);
  const parts: Part[] = [{ text: userText }];

  if (input.imageBase64) {
    const pureBase64 = input.imageBase64.startsWith('data:')
      ? input.imageBase64.split(',')[1] ?? ''
      : input.imageBase64;

    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data:     pureBase64,
      },
    });
  }

  return [{ role: 'user', parts }];
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