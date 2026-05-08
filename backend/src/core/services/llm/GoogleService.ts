import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { ProfileKey, Profiles } from './LLMsProfiles';
import { LLMClient, StepModelInput, StepModelOutput } from './ILLMService';
import { resolveImageDimensions, interpolatePrompt } from './promptUtils';
import 'dotenv/config';
import * as fs   from 'fs';
import * as path from 'path';

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
    const safeModel = model.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir       = path.join(
      RESPONSES_DIR,
      `${profile}-${safeModel}`,
      `step${stepIndex}_${timestamp}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'raw_response.json'), rawContent, 'utf-8');
    fs.writeFileSync(path.join(dir, 'parsed.json'), JSON.stringify(parsed, null, 2), 'utf-8');
    console.log(`[GoogleService] 💾 response saved to ${dir}`);
  } catch (err) {
    console.warn('[GoogleService] saveResponses failed:', (err as Error).message);
  }
}

// ────────────────────────────────────────────────────────────────────────────

export class GoogleLLMClient implements LLMClient {
  private readonly client: GoogleGenerativeAI;

  constructor() {
    this.client = new GoogleGenerativeAI(GOOGLE_API_KEY!);
  }

  async callStep(input: StepModelInput, signal?: AbortSignal): Promise<StepModelOutput> {
    console.log('[GoogleService] Calling Google API');

    const model = this.client.getGenerativeModel({
      model: 'models/gemini-2.5-flash',
      generationConfig: {
        temperature:      0.2,
        maxOutputTokens:  40000,
        responseMimeType: 'application/json',
      },
    });

    const contents = buildContents(input);

    // ── Resolve real image dimensions and inject into the prompt template ──
    const rawTemplate  = Profiles[input.profile] ?? Profiles['AnalisysComponentsLLM'];
    const dims         = input.imageBase64
      ? resolveImageDimensions(input.imageBase64)
      : { width: 0, height: 0 };
    const systemPrompt = interpolatePrompt(rawTemplate, {
      IMAGE_WIDTH:  dims.width,
      IMAGE_HEIGHT: dims.height,
    });

    console.log(
      `[GoogleService] Image dimensions: ${dims.width}×${dims.height} ` +
      `| Profile: ${input.profile}`,
    );

    try {
      const result   = await model.generateContent({ contents, systemInstruction: systemPrompt });
      const response = result.response;
      const content  = response.text();
      const parsed   = safeParseJson(content);

      saveResponses({
        profile:    input.profile,
        model:      input.model ?? 'gemini-2.5-flash',
        stepIndex:  input.stepIndex,
        rawContent: content,
        parsed,
      });

      if (input.profile === 'AnalisysComponentsLLM' && input.imageBase64) {
        return {
          action:             parsed.action             ?? '',
          rationale:          parsed.rationale          ?? '',
          numberOfComponents: parsed.length,
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
      throw new Error('Google AI error: ' + (error.message || JSON.stringify(error)));
    }
  }
}

// ── Content builder helpers ───────────────────────────────────────────────────

function buildContents(input: StepModelInput): Content[] {
  const parts: Part[] = [{ text: buildUserText(input) }];

  if (input.imageBase64) {
    const pureBase64 = input.imageBase64.startsWith('data:')
      ? input.imageBase64.split(',')[1] ?? ''
      : input.imageBase64;
    parts.push({ inlineData: { mimeType: 'image/png', data: pureBase64 } });
  }

  return [{ role: 'user', parts }];
}

function buildUserText(input: StepModelInput): string {
  const parts: string[] = [];
  parts.push(`User objective: ${input.objective}`);
  parts.push(`Current step: ${input.stepIndex}`);

  if (input.historySummary) {
    parts.push(`Summary of previous steps: ${input.historySummary}`);
  }
  if (input.uiJson) {
    parts.push(
      `Interface elements as JSON (use if helpful, no need to repeat everything):\n${input.uiJson}`,
    );
  }
  if (input.profile !== 'AnalisysComponentsLLM') {
    parts.push(
      [
        'Respond ONLY in JSON with the fields:',
        ' - action: string, next concrete user action;',
        ' - rationale: string, reasoning for the choice;',
        ' - confidence: integer 0-100.',
      ].join('\n'),
    );
  }
  return parts.join('\n\n');
}

function safeParseJson(content: string): any {
  try { return JSON.parse(content); }
  catch { return {}; }
}
