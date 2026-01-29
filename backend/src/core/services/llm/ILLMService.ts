import { ProfileKey, Profiles } from "./LLMsProfiles"

export type StepModelInput = {
    model: string,
    profile: ProfileKey
    objective: string,
    stepIndex: number,
    historySummary?: string,
    uiJson?: string,
    imageBase64?: string
}

export type StepModelOutput = {
    action: string,
    rationale: string,
    confidence: number,
    rawResponse: unknown,
}

export interface LLMClient {
  callStep(input: StepModelInput, signal?: AbortSignal): Promise<StepModelOutput>;
}

export interface ILLMService {
    callModel(input : StepModelInput) : Promise<StepModelOutput>
} 
