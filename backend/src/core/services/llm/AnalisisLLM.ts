// core/services/AnalysisLLMService.ts
import type { ProfileKey } from './LLMsProfiles';
import type { CallModelResult, ILLMService, LLMClient, StepModelInput } from './ILLMService';
import { ModelsAvaibleKey } from './LLMModesAvaible';
import { UiElement, AnalysisInput } from '../ImageAnnotation';


// ─────────────────────────────────────────────
// Tipos auxiliares
// ─────────────────────────────────────────────

export interface UiCleanResult {
  /** JSON original completo, sem nenhuma alteração */
  full:  UiElement[];
  /** JSON limpo: sem campos vazios, sem IDs e sem campos excluídos */
  clean: UiElement[];
}


// ─────────────────────────────────────────────
// Extração de UiElements do output do LLM
// Suporta:
//   1. analysis.ui já populado (campo direto)
//   2. rawResponse.candidates[*].content.parts[*].text (JSON embutido como string)
// ─────────────────────────────────────────────

function extractUiFromAnalysis(analysis: AnalysisInput): UiElement[] {
  if (Array.isArray(analysis.ui) && analysis.ui.length > 0) {
    return analysis.ui;
  }

  const text = extractRawText(analysis);
  if (!text) return [];

  return parseUiJsonText(text);
}

function extractRawText(analysis: AnalysisInput): string | null {
  const candidates = (analysis as any).rawResponse?.candidates;
  if (!Array.isArray(candidates)) return null;

  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.trim()) return part.text;
    }
  }
  return null;
}

function parseUiJsonText(text: string): UiElement[] {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i,     '')
    .replace(/\s*```$/i,     '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed as UiElement[];
  } catch {
    const start = cleaned.indexOf('[');
    const end   = cleaned.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed as UiElement[];
      } catch { /* ignora */ }
    }
  }

  console.warn('[AnalisisLLM] Não foi possível parsear UiElements do rawResponse.');
  return [];
}


// ─────────────────────────────────────────────
// Utilitários de limpeza
// ─────────────────────────────────────────────

/** Remove elementos cujo id esteja na lista */
export function stripElementsById(
  ui:          UiElement[],
  idsToRemove: string[],
): UiElement[] {
  if (!idsToRemove.length) return ui;
  const set = new Set(idsToRemove);
  return ui.filter((el) => !el.id || !set.has(el.id));
}

/** Remove campos específicos de todos os elementos (ex: "coordenadas", "region") */
export function stripFields(
  ui:             UiElement[],
  fieldsToRemove: string[],
): UiElement[] {
  if (!fieldsToRemove.length) return ui;
  const keys = new Set(fieldsToRemove);
  return ui.map((el) => {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el)) {
      if (!keys.has(k)) result[k] = v;
    }
    return result as unknown as UiElement;
  });
}

/** Remove campos com valor vazio (null, "", [], {}) de cada elemento */
export function stripEmptyFields(ui: UiElement[]): UiElement[] {
  return ui.map((el) => removeEmpty(el) as UiElement);
}

/**
 * Pipeline completo de limpeza:
 *   1. stripElementsById  → remove elementos inteiros por id
 *   2. stripFields        → remove campos específicos de todos os elementos
 *   3. stripEmptyFields   → remove campos com valor vazio
 */
export function buildCleanResult(
  ui:             UiElement[],
  idsToRemove:    string[] = [],
  fieldsToRemove: string[] = [],
): UiCleanResult {
  const full        = ui;
  const withoutIds  = stripElementsById(ui, idsToRemove);
  const withoutFlds = stripFields(withoutIds, fieldsToRemove);
  const clean       = stripEmptyFields(withoutFlds);
  return { full, clean };
}


// ─────────────────────────────────────────────
// Helpers recursivos internos
// ─────────────────────────────────────────────

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  ) return true;
  return false;
}

function removeEmpty(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => removeEmpty(item)).filter((item) => !isEmpty(item));
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const cleaned = removeEmpty(value);
      if (!isEmpty(cleaned)) result[key] = cleaned;
    }
    return result;
  }

  return obj;
}


// ─────────────────────────────────────────────
// Classe principal
// ─────────────────────────────────────────────

export class AnalisisLLM implements ILLMService {
  public readonly profile: ProfileKey = 'AnalisysComponentsLLM';
  public readonly model:   ModelsAvaibleKey;
  private history: string[] = [];

  constructor(
    private readonly client: LLMClient,
    model?: ModelsAvaibleKey,
  ) {
    this.model = model ?? 'google/gemma-3-12b-it:free';
  }

  addToHistory(entry: string): void { this.history.push(entry); }
  clearHistory(): void              { this.history = []; }

  /**
   * Chama o LLM e retorna o resultado processado.
   *
   * @param idsToRemove    IDs de elementos a excluir do clean
   * @param fieldsToRemove Campos a remover de todos os elementos no clean
   *                       ex: ["coordenadas", "region", "color", "meta"]
   *
   * @returns full  — todos os elementos sem alteração
   * @returns clean — elementos após as três etapas de limpeza
   */
  async callModel(
    params:         StepModelInput,
    idsToRemove:    string[] = [],
    fieldsToRemove: string[] = [],
  ): Promise<CallModelResult> {
    const input: StepModelInput = {
      model:          params.model,
      profile:        this.profile,
      objective:      params.objective,
      stepIndex:      params.stepIndex,
      historySummary: params.historySummary,
      uiJson:         params.uiJson,
      imageBase64:    params.imageBase64,
    };

    const output = await this.client.callStep(input);

    this.addToHistory(
      `Passo ${params.stepIndex}: ação=${output.action}, confiança=${output.confidence}`,
    );

    const { full, clean } = this.buildUiResultFromAnalysis(
      output as AnalysisInput,
      idsToRemove,
      fieldsToRemove,
    );

    console.log(`[AnalisisLLM] full=${full.length} | clean=${clean.length} (removidos: ids=${idsToRemove.length} fields=${fieldsToRemove.length})`);

    return { output, full, clean };
  }

  // ── API pública de limpeza ───────────────────────────────────────────────

  cleanEmptyFields(ui: UiElement[]): UiElement[] {
    return stripEmptyFields(ui);
  }

  removeElementsById(ui: UiElement[], idsToRemove: string[]): UiElement[] {
    return stripElementsById(ui, idsToRemove);
  }

  removeFields(ui: UiElement[], fieldsToRemove: string[]): UiElement[] {
    return stripFields(ui, fieldsToRemove);
  }

  buildUiResult(
    ui:             UiElement[],
    idsToRemove:    string[] = [],
    fieldsToRemove: string[] = [],
  ): UiCleanResult {
    return buildCleanResult(ui, idsToRemove, fieldsToRemove);
  }

  buildUiResultFromAnalysis(
    analysis:       AnalysisInput,
    idsToRemove:    string[] = [],
    fieldsToRemove: string[] = [],
  ): UiCleanResult {
    const ui = extractUiFromAnalysis(analysis);

    if (ui.length === 0) {
      console.warn('[AnalisisLLM] buildUiResultFromAnalysis: nenhum UiElement encontrado.');
    }

    return buildCleanResult(ui, idsToRemove, fieldsToRemove);
  }
}
