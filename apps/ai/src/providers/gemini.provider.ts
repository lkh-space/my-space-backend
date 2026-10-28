import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type {
  LlmProvider,
  EmbeddingProvider,
  LlmMessage,
  LlmToolDefinition,
  LlmResponse,
  LlmToolCall,
  LlmStreamChunk,
} from './llm.provider.interface.js';

@Injectable()
export class GeminiProvider implements LlmProvider, EmbeddingProvider {
  public readonly name = 'gemini';
  public readonly dimension = 768;
  private readonly logger = new Logger(GeminiProvider.name);
  private client: GoogleGenAI | null = null;
  public readonly model: string;
  public readonly embeddingModel: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ai.gemini.apiKey', '');
    this.model = this.configService.get<string>('ai.gemini.model', 'gemini-3.8-flash');
    this.embeddingModel = this.configService.get<string>(
      'ai.gemini.embeddingModel',
      'gemini-embedding-001',
    );

    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 60000 } });
    } else {
      this.logger.warn(
        'GEMINI_API_KEY가 설정되지 않았습니다. Gemini Provider 호출 시 에러가 발생할 수 있습니다.',
      );
    }
  }

  private ensureClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = this.configService.get<string>('ai.gemini.apiKey', '');
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY가 설정되지 않아 호출할 수 없습니다.');
      }
      this.client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 60000 } });
    }
    return this.client;
  }

  private isTransientError(err: unknown): boolean {
    if (!err) return false;
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    const status = (err as { status?: number })?.status;
    return (
      status === 503 ||
      status === 429 ||
      msg.includes('503') ||
      msg.includes('unavailable') ||
      msg.includes('high demand') ||
      msg.includes('429') ||
      msg.includes('resource_exhausted') ||
      msg.includes('rate limit')
    );
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 단발성 텍스트 및 Function Call 응답 생성 (일시적 503/429 발생 시 지수 백오프 및 대체 모델 자동 폴백)
   */
  async generate(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
    signal?: AbortSignal,
  ): Promise<LlmResponse> {
    const client = this.ensureClient();

    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // 메시지 포맷 변환 (Gemini contents: system 메시지 제외 후 분리 주입)
    const contents = conversationMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // Tool 정의 변환
    const functionDeclarations = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const config: Record<string, unknown> = {};
    if (signal) {
      config.abortSignal = signal;
    }
    if (systemMessages.length > 0) {
      config.systemInstruction = systemMessages.map((m) => m.content).join('\n\n');
    }
    if (functionDeclarations && functionDeclarations.length > 0) {
      config.tools = [{ functionDeclarations }];
    }

    const candidateModels = Array.from(
      new Set([this.model, 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']),
    );

    let lastError: unknown;

    for (const targetModel of candidateModels) {
      if (signal?.aborted) break;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const response = await client.models.generateContent({
            model: targetModel,
            contents,
            config,
          });

          const candidate = response.candidates?.[0];
          const parts = candidate?.content?.parts || [];

          let textContent = '';
          const toolCalls: LlmResponse['toolCalls'] = [];

          for (const part of parts) {
            if (part.text) {
              textContent += part.text;
            }
            if (part.functionCall) {
              toolCalls.push({
                id: part.functionCall.name || 'call_id',
                name: part.functionCall.name || '',
                args: (part.functionCall.args as Record<string, unknown>) || {},
              });
            }
          }

          return {
            content: textContent,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          };
        } catch (err) {
          lastError = err;
          if (signal?.aborted) throw err;

          if (this.isTransientError(err) && attempt < 2) {
            this.logger.warn(
              `[GeminiProvider] ${targetModel} 일시적 과부하(503/429) 감지. 1.5초 후 재시도합니다... (시도 #${attempt})`,
            );
            await this.sleep(1500);
            continue;
          }

          this.logger.warn(
            `[GeminiProvider] ${targetModel} 호출 실패, 다음 대체 모델을 시도합니다: ${err instanceof Error ? err.message : String(err)}`,
          );
          break;
        }
      }
    }

    throw lastError;
  }

  /**
   * 실시간 스트리밍 생성 (AsyncGenerator, 일시적 503/429 발생 시 지수 백오프 및 대체 모델 자동 폴백)
   */
  async *stream(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
    signal?: AbortSignal,
  ): AsyncGenerator<LlmStreamChunk, void, unknown> {
    const client = this.ensureClient();

    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const contents = conversationMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const functionDeclarations = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const config: Record<string, unknown> = {};
    if (signal) {
      config.abortSignal = signal;
    }
    if (systemMessages.length > 0) {
      config.systemInstruction = systemMessages.map((m) => m.content).join('\n\n');
    }
    if (functionDeclarations && functionDeclarations.length > 0) {
      config.tools = [{ functionDeclarations }];
    }

    const candidateModels = Array.from(
      new Set([this.model, 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']),
    );

    let streamResponse: any = null;
    let lastError: unknown;

    for (const targetModel of candidateModels) {
      if (signal?.aborted) return;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          streamResponse = await client.models.generateContentStream({
            model: targetModel,
            contents,
            config,
          });
          break;
        } catch (err) {
          lastError = err;
          if (signal?.aborted) return;

          if (this.isTransientError(err) && attempt < 2) {
            this.logger.warn(
              `[GeminiProvider] 스트리밍 중 ${targetModel} 일시적 과부하(503/429) 감지. 1.5초 후 재시도합니다... (시도 #${attempt})`,
            );
            await this.sleep(1500);
            continue;
          }

          this.logger.warn(
            `[GeminiProvider] 스트리밍 ${targetModel} 실패, 다음 대체 모델을 시도합니다: ${err instanceof Error ? err.message : String(err)}`,
          );
          break;
        }
      }

      if (streamResponse) break;
    }

    if (!streamResponse) {
      throw lastError;
    }

    for await (const chunk of streamResponse) {
      if (signal?.aborted) break;

      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      let text = '';
      const toolCalls: LlmToolCall[] = [];

      for (const part of parts) {
        if (part.text) {
          text += part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            id: part.functionCall.name || 'call_id',
            name: part.functionCall.name || '',
            args: (part.functionCall.args as Record<string, unknown>) || {},
          });
        }
      }

      if (toolCalls.length > 0) {
        yield { toolCalls, text: text || undefined };
      } else if (text || chunk.text) {
        yield { text: text || chunk.text };
      }
    }
  }

  /**
   * 단일 텍스트 임베딩 (768 차원)
   */
  async embedText(text: string): Promise<number[]> {
    const client = this.ensureClient();
    const res = await client.models.embedContent({
      model: this.embeddingModel,
      contents: text,
      config: {
        outputDimensionality: 768,
      },
    });

    const values =
      res.embeddings?.[0]?.values ?? (res as any).embedding?.values;
    if (!values) {
      throw new Error('Gemini 임베딩 생성 결과가 비어있습니다.');
    }
    return values;
  }

  /**
   * 배치 텍스트 임베딩
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const t of texts) {
      results.push(await this.embedText(t));
    }
    return results;
  }
}
