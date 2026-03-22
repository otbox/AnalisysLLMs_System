import { CallModelResult, ILLMService, StepModelInput } from './llm/ILLMService';
import { AnalisisLLM } from './llm/AnalisisLLM';
import PQueue from 'p-queue';

export class QueueService {
  private readonly queue: PQueue;

  constructor(
    private readonly analisis: AnalisisLLM,
    concurrency = 1,        
    intervalCap?: number,     
    interval?: number,       
  ) {
    this.queue = new PQueue({
      concurrency,
      ...(intervalCap && interval ? { intervalCap, interval } : {}),
    });
  }

  async enqueue(
    params: StepModelInput,
    idsToRemove: string[] = [],
  ): Promise<CallModelResult> {
    return this.queue.add(
      () => this.analisis.callModel(params, idsToRemove)
    );
  }

  get pending(): number {
    return this.queue.size;
  }

  get running(): number {
    return this.queue.pending;
  }

  async waitForIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  clear(): void {
    this.queue.clear();
  }
}
