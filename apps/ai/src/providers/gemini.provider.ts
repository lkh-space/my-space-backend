import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type {
  LlmProvider,
  EmbeddingProvider,
  LlmMessage,
  LlmToolDefinition,
  LlmResponse,
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
    this.model = this.configService.get<string>('ai.gemini.model', 'gemini-3.5-flash');
    this.embeddingModel = this.configService.get<string>(
      'ai.gemini.embeddingModel',
      'gemini-embedding-001',
    );

    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
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
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  /**
   * 단발성 텍스트 및 Function Call 응답 생성
   */
  async generate(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
  ): Promise<LlmResponse> {
    const client = this.ensureClient();

    // 메시지 포맷 변환 (Gemini contents)
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : m.role === 'system' ? 'user' : 'user',
      parts: [{ text: m.content }],
    }));

    // Tool 정의 변환
    const functionDeclarations = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const config: Record<string, unknown> = {};
    if (functionDeclarations && functionDeclarations.length > 0) {
      config.tools = [{ functionDeclarations }];
    }

    const response = await client.models.generateContent({
      model: this.model,
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
  }

  /**
   * 실시간 스트리밍 생성 (AsyncGenerator)
   */
  async *stream(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
  ): AsyncGenerator<string, void, unknown> {
    const client = this.ensureClient();

    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const functionDeclarations = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const config: Record<string, unknown> = {};
    if (functionDeclarations && functionDeclarations.length > 0) {
      config.tools = [{ functionDeclarations }];
    }

    let streamResponse;
    try {
      streamResponse = await client.models.generateContentStream({
        model: this.model,
        contents,
        config,
      });
    } catch (err) {
      if (this.model !== 'gemini-3.5-flash') {
        this.logger.warn(
          `[GeminiProvider] ${this.model} 호출 실패로 gemini-3.5-flash로 자동 폴백합니다: ${err}`,
        );
        streamResponse = await client.models.generateContentStream({
          model: 'gemini-3.5-flash',
          contents,
          config,
        });
      } else {
        throw err;
      }
    }

    for await (const chunk of streamResponse) {
      const text = chunk.text;
      if (text) {
        yield text;
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
