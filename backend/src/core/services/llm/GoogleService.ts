import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { ProfileKey, Profiles } from './LLMsProfiles';
import { LLMClient, StepModelInput, StepModelOutput } from './ILLMService';
import 'dotenv/config';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  throw new Error('GOOGLE_API_KEY not defined');
}

export class GoogleLLMClient implements LLMClient {
  private readonly client: GoogleGenerativeAI;

  constructor() {
    this.client = new GoogleGenerativeAI(GOOGLE_API_KEY!);
  }

  async callStep(input: StepModelInput, signal?: AbortSignal): Promise<StepModelOutput> {
    console.log("Calling google API")
    const model = this.client.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 15000,
        responseMimeType: 'application/json',
      }
    });

    const contents = buildContents(input);
    const systemPrompt = Profiles[input.profile] ?? Profiles['AnalisysComponentsLLM'];

    try {
      const result = await model.generateContent({
        contents,
        systemInstruction: systemPrompt,
      });

      const response = result.response;
      const content = response.text();
      const parsed = safeParseJson(content);

      return {
        action: parsed.action ?? '',
        rationale: parsed.rationale ?? '',
        confidence: parsed.confidence ?? 0,
        rawResponse: response,
      };
    } catch (error: any) {
      throw new Error(
        'Google AI error: ' + (error.message || JSON.stringify(error))
      );
    }
  }
}

/** ==== Helpers de construção de conteúdo ==== */
function buildContents(input: StepModelInput): Content[] {
  const userText = buildUserText(input);
  const parts: Part[] = [{ text: userText }];

  if (input.imageBase64) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: input.imageBase64,
      },
    });
  }

  return [
    {
      role: 'user',
      parts,
    },
  ];
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
      `Elementos da interface em JSON (use se ajudar, não precisa repetir tudo):\n${input.uiJson}`
    );
  }

  if (input.profile !== 'AnalisysComponentsLLM') {
    parts.push(
      [
        'Responda APENAS em JSON com os campos:',
        ' - action: string, próxima acção concreta do usuário;',
        ' - rationale: string, explicação da escolha;',
        ' - confidence: inteiro de 0 a 100, representando a confiança em %.',
      ].join('\n')
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
