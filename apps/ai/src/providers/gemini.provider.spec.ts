import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from './gemini.provider.js';
import type { ConfigService } from '@nestjs/config';

describe('GeminiProvider (BDD 단위 테스트)', () => {
  let mockConfigService: ConfigService;

  beforeEach(() => {
    mockConfigService = {
      get: vi.fn((key: string, defaultValue?: any) => {
        if (key === 'ai.gemini.apiKey') return 'mock-gemini-key';
        if (key === 'ai.gemini.model') return 'gemini-3.8-flash';
        if (key === 'ai.gemini.embeddingModel') return 'text-embedding-004';
        return defaultValue;
      }),
    } as unknown as ConfigService;
  });

  it('API 키가 제공되면 클라이언트가 초기화된다', () => {
    // given & when
    const provider = new GeminiProvider(mockConfigService);

    // then
    expect(provider.name).toBe('gemini');
    expect(provider.dimension).toBe(768);
    expect(provider.model).toBe('gemini-3.8-flash');
  });

  it('API 키가 없을 때 호출하면 예외를 던진다', async () => {
    // given
    const emptyKeyConfig = {
      get: vi.fn((key: string, defaultValue?: any) => {
        if (key === 'ai.gemini.apiKey') return '';
        return defaultValue;
      }),
    } as unknown as ConfigService;
    const provider = new GeminiProvider(emptyKeyConfig);

    // when & then
    await expect(
      provider.generate([{ role: 'user', content: '안녕' }]),
    ).rejects.toThrow('GEMINI_API_KEY가 설정되지 않아');
  });

  it('일반 텍스트 질의 시 generateContent 결과를 LlmResponse로 파싱하여 반환한다', async () => {
    // given
    const provider = new GeminiProvider(mockConfigService);
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ text: '안녕하세요! 저는 AI 도우미입니다.' }],
              },
            },
          ],
        }),
      },
    };
    (provider as any).client = mockClient;

    // when
    const res = await provider.generate([
      { role: 'user', content: '안녕하세요' },
    ]);

    // then
    expect(res.content).toBe('안녕하세요! 저는 AI 도우미입니다.');
    expect(res.toolCalls).toBeUndefined();
    expect(mockClient.models.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.8-flash',
        contents: [{ role: 'user', parts: [{ text: '안녕하세요' }] }],
      }),
    );
  });

  it('system role 메시지가 포함된 경우 contents에 포함하지 않고 config.systemInstruction으로 분리 주입한다', async () => {
    // given
    const provider = new GeminiProvider(mockConfigService);
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ text: '안전 지침을 준수한 응답입니다.' }],
              },
            },
          ],
        }),
      },
    };
    (provider as any).client = mockClient;

    // when
    const res = await provider.generate([
      { role: 'system', content: '당신은 보안 AI 어시스턴트입니다.' },
      { role: 'user', content: '안녕하세요' },
    ]);

    // then
    expect(res.content).toBe('안전 지침을 준수한 응답입니다.');
    expect(mockClient.models.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [{ role: 'user', parts: [{ text: '안녕하세요' }] }],
        config: expect.objectContaining({
          systemInstruction: '당신은 보안 AI 어시스턴트입니다.',
        }),
      }),
    );
  });

  it('도구 호출(Function Calling) 응답 시 toolCalls 배열을 정상 추출한다', async () => {
    // given
    const provider = new GeminiProvider(mockConfigService);
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'search_my_documents',
                      args: { query: 'NestJS 가이드' },
                    },
                  },
                ],
              },
            },
          ],
        }),
      },
    };
    (provider as any).client = mockClient;

    // when
    const res = await provider.generate(
      [{ role: 'user', content: '문서 찾아줘' }],
      [
        {
          name: 'search_my_documents',
          description: '문서 검색',
          parameters: { type: 'OBJECT', properties: {} },
        },
      ],
    );

    // then
    expect(res.toolCalls).toBeDefined();
    expect(res.toolCalls?.length).toBe(1);
    expect(res.toolCalls?.[0].name).toBe('search_my_documents');
    expect(res.toolCalls?.[0].args).toEqual({ query: 'NestJS 가이드' });
  });

  it('embedText 호출 시 768차원 벡터 배열을 반환한다', async () => {
    // given
    const provider = new GeminiProvider(mockConfigService);
    const mockVector = Array.from({ length: 768 }, () => 0.123);
    const mockClient = {
      models: {
        embedContent: vi.fn().mockResolvedValue({
          embeddings: [{ values: mockVector }],
        }),
      },
    };
    (provider as any).client = mockClient;

    // when
    const vector = await provider.embedText('테스트 텍스트');

    // then
    expect(vector).toEqual(mockVector);
    expect(vector.length).toBe(768);
  });

  describe('stream (실시간 스트리밍)', () => {
    it('일반 텍스트 스트리밍 시 text 청크를 순차적으로 방출하고 config.abortSignal을 전달한다', async () => {
      // given
      const provider = new GeminiProvider(mockConfigService);
      async function* mockStreamGenerator() {
        yield { candidates: [{ content: { parts: [{ text: '안녕' }] } }] };
        yield { candidates: [{ content: { parts: [{ text: '하세요' }] } }] };
      }
      const mockClient = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockStreamGenerator()),
        },
      };
      (provider as any).client = mockClient;

      const ac = new AbortController();

      // when
      const chunks: Array<{ text?: string }> = [];
      for await (const chunk of provider.stream(
        [{ role: 'user', content: '안녕' }],
        undefined,
        ac.signal,
      )) {
        chunks.push(chunk);
      }

      // then
      expect(mockClient.models.generateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            abortSignal: ac.signal,
          }),
        }),
      );
      expect(chunks).toEqual([{ text: '안녕' }, { text: '하세요' }]);
    });

    it('스트림 내에 functionCall이 포함되어 있으면 toolCalls를 포함한 청크를 방출한다', async () => {
      // given
      const provider = new GeminiProvider(mockConfigService);
      async function* mockStreamGenerator() {
        yield {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'search_my_documents',
                      args: { query: 'NestJS' },
                    },
                  },
                ],
              },
            },
          ],
        };
      }
      const mockClient = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockStreamGenerator()),
        },
      };
      (provider as any).client = mockClient;

      // when
      const chunks: any[] = [];
      for await (const chunk of provider.stream(
        [{ role: 'user', content: '문서 검색' }],
        [
          {
            name: 'search_my_documents',
            description: '검색',
            parameters: { type: 'object', properties: {} },
          },
        ],
      )) {
        chunks.push(chunk);
      }

      // then
      expect(chunks.length).toBe(1);
      expect(chunks[0].toolCalls).toEqual([
        {
          id: 'search_my_documents',
          name: 'search_my_documents',
          args: { query: 'NestJS' },
        },
      ]);
    });
  });
});
