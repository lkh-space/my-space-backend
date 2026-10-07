import { Injectable } from '@nestjs/common';
import type {
  LlmProvider,
  EmbeddingProvider,
  LlmMessage,
  LlmResponse,
  LlmToolDefinition,
} from '../../apps/ai/src/providers/llm.provider.interface.js';

export type MockGenerateFn = (
  messages: LlmMessage[],
  tools?: LlmToolDefinition[],
) => Promise<LlmResponse>;

export type MockStreamFn = (
  messages: LlmMessage[],
  tools?: LlmToolDefinition[],
) => AsyncGenerator<string, void, unknown>;

@Injectable()
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake-gemini';
  private customGenerateFn: MockGenerateFn | null = null;
  private customStreamFn: MockStreamFn | null = null;

  setCustomGenerate(fn: MockGenerateFn | null): void {
    this.customGenerateFn = fn;
  }

  setCustomStream(fn: MockStreamFn | null): void {
    this.customStreamFn = fn;
  }

  reset(): void {
    this.customGenerateFn = null;
    this.customStreamFn = null;
  }

  async generate(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
  ): Promise<LlmResponse> {
    if (this.customGenerateFn) {
      return this.customGenerateFn(messages, tools);
    }

    const lastMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

    // 도구 실행 결과가 이미 포함된 경우 -> 최종 답변 반환
    const hasToolResult = messages.some((m) => m.content.includes('도구') && m.content.includes('결과:'));
    if (hasToolResult) {
      return {
        content: '도구 검색 결과를 바탕으로 답변을 완성했습니다.',
      };
    }

    // 도구 호출 모의 트리거: 메시지에 '검색'이 포함된 경우
    if (tools && lastMessage.includes('검색')) {
      return {
        content: '',
        toolCalls: [
          {
            id: 'call_search_1',
            name: 'search_my_documents',
            args: { query: 'NestJS' },
          },
        ],
      };
    }

    // 도구 호출 모의 트리거: 메시지에 '저장'이 포함된 경우
    if (tools && lastMessage.includes('저장')) {
      return {
        content: '',
        toolCalls: [
          {
            id: 'call_save_1',
            name: 'save_to_markdown',
            args: {
              title: '자동 저장된 AI 문서',
              content: '# AI 요약 노트\n본문 내용입니다.',
              tags: ['ai', 'note'],
            },
          },
        ],
      };
    }

    return {
      content: `[Mock AI 응답] 질의하신 내용: "${lastMessage}"에 대한 답변입니다.`,
    };
  }

  async *stream(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
  ): AsyncGenerator<string, void, unknown> {
    if (this.customStreamFn) {
      yield* this.customStreamFn(messages, tools);
      return;
    }

    yield '안녕하세요! ';
    yield '모의 AI 스트리밍 ';
    yield '답변입니다.';
  }
}

@Injectable()
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'fake-embedding';
  readonly dimension = 768;

  async embedText(_text: string): Promise<number[]> {
    // 768차원 부동소수점 임베딩 벡터
    return Array.from({ length: this.dimension }, () => 0.05);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() =>
      Array.from({ length: this.dimension }, () => 0.05),
    );
  }
}

@Injectable()
export class FakeProviderFactory {
  constructor(
    readonly fakeLlm: FakeLlmProvider,
    readonly fakeEmbedding: FakeEmbeddingProvider,
  ) {}

  getLlmProvider(_providerName?: string): LlmProvider {
    return this.fakeLlm;
  }

  getEmbeddingProvider(_providerName?: string): EmbeddingProvider {
    return this.fakeEmbedding;
  }
}
