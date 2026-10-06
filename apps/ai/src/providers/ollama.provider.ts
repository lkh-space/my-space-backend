import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  LlmProvider,
  EmbeddingProvider,
  LlmMessage,
  LlmToolDefinition,
  LlmResponse,
} from './llm.provider.interface.js';

@Injectable()
export class OllamaProvider implements LlmProvider, EmbeddingProvider {
  public readonly name = 'ollama';
  public readonly dimension = 768;
  private readonly logger = new Logger(OllamaProvider.name);
  public readonly baseUrl: string;
  public readonly model: string;
  public readonly embeddingModel: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService
      .get<string>('ai.ollama.baseUrl', 'http://localhost:11434')
      .replace(/\/+$/, '');
    this.model = this.configService.get<string>('ai.ollama.model', 'qwen3.5:0.8b');
    this.embeddingModel = this.configService.get<string>(
      'ai.ollama.embeddingModel',
      'nomic-embed-text',
    );
  }

  /**
   * Ollama 단발성 대화 생성
   */
  async generate(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
  ): Promise<LlmResponse> {
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      };

      if (tools && tools.length > 0) {
        body.tools = tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));
      }

      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Ollama API 에러 (${res.status}): ${errorText}`);
      }

      const data = (await res.json()) as {
        message?: {
          content?: string;
          tool_calls?: Array<{
            function?: { name?: string; arguments?: Record<string, unknown> };
          }>;
        };
      };

      const content = data.message?.content || '';
      const rawToolCalls = data.message?.tool_calls || [];

      const toolCalls = rawToolCalls.map((tc, idx) => ({
        id: `call_${idx}_${tc.function?.name}`,
        name: tc.function?.name || '',
        args: tc.function?.arguments || {},
      }));

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Ollama 호출 실패: ${message}`);
      throw err;
    }
  }

  /**
   * Ollama 스트리밍 대화 생성 (AsyncGenerator)
   */
  async *stream(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
  ): AsyncGenerator<string, void, unknown> {
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      };

      if (tools && tools.length > 0) {
        body.tools = tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));
      }

      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const errorText = await res.text();
        throw new Error(`Ollama 스트리밍 에러 (${res.status}): ${errorText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as {
              message?: { content?: string };
            };
            if (parsed.message?.content) {
              yield parsed.message.content;
            }
          } catch {
            // json 파싱 오류 무시
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Ollama 스트리밍 실패: ${message}`);
      throw err;
    }
  }

  /**
   * 단일 텍스트 임베딩 생성 (nomic-embed-text 등)
   */
  async embedText(text: string): Promise<number[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Ollama 임베딩 에러 (${res.status}): ${errorText}`);
      }

      const data = (await res.json()) as { embedding?: number[] };
      if (!data.embedding || data.embedding.length === 0) {
        throw new Error('Ollama 임베딩 결과가 비어있습니다.');
      }

      return data.embedding;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Ollama 임베딩 실패: ${message}`);
      throw err;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const t of texts) {
      results.push(await this.embedText(t));
    }
    return results;
  }
}
