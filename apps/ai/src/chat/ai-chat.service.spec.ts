import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiChatService } from './ai-chat.service.js';
import type { ProviderFactory } from '../providers/provider.factory.js';
import type { AiToolsService } from '../tools/ai-tools.service.js';
import type { LlmProvider } from '../providers/llm.provider.interface.js';

describe('AiChatService (BDD 단위 테스트)', () => {
  let service: AiChatService;
  let mockProviderFactory: ProviderFactory;
  let mockAiToolsService: AiToolsService;
  let mockLlmProvider: LlmProvider;

  beforeEach(() => {
    mockLlmProvider = {
      name: 'gemini',
      generate: vi.fn(),
      stream: vi.fn(),
    };

    mockProviderFactory = {
      getLlmProvider: vi.fn().mockReturnValue(mockLlmProvider),
      getEmbeddingProvider: vi.fn(),
    } as unknown as ProviderFactory;

    mockAiToolsService = {
      getToolDefinitions: vi.fn().mockReturnValue([
        {
          name: 'search_my_documents',
          description: '문서 검색',
          parameters: { type: 'OBJECT', properties: {} },
        },
      ]),
      executeTool: vi.fn(),
    } as unknown as AiToolsService;

    service = new AiChatService(mockProviderFactory, mockAiToolsService);
  });

  describe('단발성 대화 (chat)', () => {
    it('도구 호출 없이 즉시 답변이 나오는 경우 최종 메시지를 반환한다', async () => {
      // given
      vi.spyOn(mockLlmProvider, 'generate').mockResolvedValue({
        content: '네, 반갑습니다! 무엇을 도와드릴까요?',
      });

      const dto = {
        messages: [{ role: 'user' as const, content: '안녕' }],
      };

      // when
      const result = await service.chat('user-1', dto);

      // then
      expect(result.message.content).toBe('네, 반갑습니다! 무엇을 도와드릴까요?');
      expect(result.toolExecutions).toBeUndefined();
      expect(mockLlmProvider.generate).toHaveBeenCalledTimes(1);
    });

    it('LLM이 도구 호출을 요청하면 도구를 실행한 후 후속 응답을 생성하여 반환한다', async () => {
      // given
      vi.spyOn(mockLlmProvider, 'generate')
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'search_my_documents',
              args: { query: 'NestJS 가이드' },
            },
          ],
        })
        .mockResolvedValueOnce({
          content: '검색된 문서를 확인한 결과, NestJS는 모듈러 아키텍처를 지원합니다.',
        });

      vi.spyOn(mockAiToolsService, 'executeTool').mockResolvedValue(
        '검색 결과: NestJS는 뛰어난 모듈러 프레임워크입니다.',
      );

      const dto = {
        messages: [{ role: 'user' as const, content: '내 NestJS 문서 찾아줘' }],
      };

      // when
      const result = await service.chat('user-1', dto);

      // then
      expect(mockAiToolsService.executeTool).toHaveBeenCalledWith(
        'search_my_documents',
        { query: 'NestJS 가이드' },
        'user-1',
      );
      expect(result.toolExecutions?.length).toBe(1);
      expect(result.toolExecutions?.[0].name).toBe('search_my_documents');
      expect(result.message.content).toBe(
        '검색된 문서를 확인한 결과, NestJS는 모듈러 아키텍처를 지원합니다.',
      );
      expect(mockLlmProvider.generate).toHaveBeenCalledTimes(2);
    });
  });

  describe('실시간 스트리밍 대화 (streamChat)', () => {
    it('도구 호출이 없는 일반 응답 스트리밍 시 token과 done 이벤트를 방출한다', async () => {
      // given
      vi.spyOn(mockLlmProvider, 'generate').mockResolvedValue({
        content: '안녕하세요! 좋은 하루입니다.',
      });

      const dto = {
        messages: [{ role: 'user' as const, content: '안녕' }],
      };

      // when
      const events: Array<{ event: string; data: string }> = [];
      for await (const chunk of service.streamChat('user-1', dto)) {
        events.push(chunk);
      }

      // then
      expect(events.length).toBe(2);
      expect(events[0].event).toBe('token');
      expect(JSON.parse(events[0].data).delta).toBe('안녕하세요! 좋은 하루입니다.');
      expect(events[1].event).toBe('done');
    });

    it('도구 호출이 포함된 스트리밍 시 tool_start, tool_end, token, done 이벤트를 순차적으로 방출한다', async () => {
      // given
      vi.spyOn(mockLlmProvider, 'generate').mockResolvedValue({
        content: '',
        toolCalls: [
          {
            id: 'call_2',
            name: 'search_my_documents',
            args: { query: 'Qdrant 가이드' },
          },
        ],
      });

      vi.spyOn(mockAiToolsService, 'executeTool').mockResolvedValue(
        'Qdrant 검색 결과 내용...',
      );

      async function* mockStreamGenerator() {
        yield 'Qdrant는 ';
        yield '벡터 데이터베이스입니다.';
      }
      vi.spyOn(mockLlmProvider, 'stream').mockImplementation(mockStreamGenerator as any);

      const dto = {
        messages: [{ role: 'user' as const, content: 'Qdrant 정보 알려줘' }],
      };

      // when
      const events: Array<{ event: string; data: string }> = [];
      for await (const chunk of service.streamChat('user-1', dto)) {
        events.push(chunk);
      }

      // then
      const eventNames = events.map((e) => e.event);
      expect(eventNames).toEqual([
        'tool_start',
        'tool_end',
        'token',
        'token',
        'done',
      ]);
      expect(JSON.parse(events[0].data).name).toBe('search_my_documents');
      expect(JSON.parse(events[1].data).status).toBe('success');
      expect(JSON.parse(events[2].data).delta).toBe('Qdrant는 ');
      expect(JSON.parse(events[3].data).delta).toBe('벡터 데이터베이스입니다.');
    });
  });
});
