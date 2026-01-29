// core/services/AnalysisLLMService.ts
import type { ProfileKey, Profiles } from './LLMsProfiles';
import type { ILLMService, LLMClient, StepModelInput, StepModelOutput } from './ILLMService';

export class AnalisisLLM implements ILLMService {
  public readonly profile: ProfileKey = 'AnalisysComponentsLLM'; 
  public readonly model: string;
  private history : string[] = []

  constructor(
    private readonly client: LLMClient,
    model?: string,
  ) {
    this.model = 'qwen/qwen-2.5-vl-7b-instruct:free';
  }

    addToHistory(entry: string) {
    this.history.push(entry);
  }

  clearHistory() {
    this.history = [];
  }


  async callModel(params: StepModelInput): Promise<StepModelOutput> {
    const input: StepModelInput = {
      model: this.model,
      profile: this.profile,
      objective: params.objective,
      stepIndex: params.stepIndex,
      historySummary: params.historySummary,
      uiJson: params.uiJson,
      imageBase64: params.imageBase64,
    };

    const output = await this.client.callStep(input)

    this.addToHistory(
      `Passo ${params.stepIndex}: ação=${output.action}, confiança=${output.confidence}`,
    );

    return output;
  }
}
