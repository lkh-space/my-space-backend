import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenSearchService } from './opensearch.service.js';
import { ConfigService } from '@nestjs/config';

describe('OpenSearchService (M-7 보안 및 신뢰성)', () => {
  let service: OpenSearchService;
  let mockClient: any;
  let configService: ConfigService;

  beforeEach(() => {
    mockClient = {
      index: vi.fn(),
      delete: vi.fn(),
      search: vi.fn(),
      indices: {
        exists: vi.fn().mockResolvedValue({ body: true }),
      },
    };

    configService = {
      get: vi.fn((key: string, defaultValue?: any) => {
        if (key === 'opensearch.indexDocuments') return 'test-index';
        return defaultValue;
      }),
    } as unknown as ConfigService;

    service = new OpenSearchService(configService);
    (service as any).client = mockClient;
    (service as any).indexName = 'test-index';
  });

  describe('indexDocument', () => {
    it('태그를 소문자 정규화하고 refresh: wait_for 옵션으로 색인해야 한다', async () => {
      // given
      const doc = {
        id: 'doc-1',
        title: 'Title',
        body: 'Body',
        tags: ['  NestJS  ', 'TYPESCRIPT', ''],
        ownerId: 'admin',
        updatedAt: '2026-10-17T00:00:00Z',
      };

      mockClient.index.mockResolvedValueOnce({ body: { result: 'created' } });

      // when
      await service.indexDocument(doc);

      // then
      expect(mockClient.index).toHaveBeenCalledWith({
        index: 'test-index',
        id: 'doc-1',
        body: {
          ...doc,
          tags: ['nestjs', 'typescript'],
        },
        refresh: 'wait_for',
      });
    });

    it('색인 실패 시 에러를 throw해야 한다 (장애 은폐 방지)', async () => {
      // given
      const doc = {
        id: 'doc-1',
        title: 'Title',
        body: 'Body',
        tags: [],
        ownerId: 'admin',
        updatedAt: '2026-10-17T00:00:00Z',
      };

      mockClient.index.mockRejectedValueOnce(new Error('Index write error'));

      // when & then
      await expect(service.indexDocument(doc)).rejects.toThrow('Index write error');
    });
  });

  describe('search', () => {
    it('highlight에 encoder: html을 적용하고 검색 실패 시 예외를 던져야 한다 (XSS 및 장애 은폐 방어)', async () => {
      // given
      const options = {
        query: 'XSS <script>',
        ownerId: 'admin',
        tag: 'NestJS',
      };

      mockClient.search.mockResolvedValueOnce({
        body: {
          hits: {
            total: 1,
            hits: [
              {
                _id: 'doc-1',
                _score: 1.0,
                _source: {
                  id: 'doc-1',
                  title: 'Title',
                  tags: ['nestjs'],
                  updatedAt: '2026-10-17T00:00:00Z',
                },
                highlight: {
                  body: ['&lt;script&gt; <em>XSS</em>'],
                },
              },
            ],
          },
        },
      });

      // when
      const result = await service.search(options);

      // then
      expect(result.total).toBe(1);
      expect(result.hits[0].snippet).toBe('&lt;script&gt; <em>XSS</em>');

      // highlight encoder: html 검증 및 tag 소문자 필터링 검증
      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            highlight: expect.objectContaining({
              encoder: 'html',
            }),
            query: expect.objectContaining({
              bool: expect.objectContaining({
                filter: expect.arrayContaining([
                  { term: { ownerId: 'admin' } },
                  { term: { tags: 'nestjs' } },
                ]),
              }),
            }),
          }),
        }),
      );
    });

    it('OpenSearch 클라이언트에서 에러가 발생하면 삼키지 않고 그대로 throw해야 한다', async () => {
      // given
      mockClient.search.mockRejectedValueOnce(new Error('Connection timed out'));

      // when & then
      await expect(
        service.search({ query: 'test', ownerId: 'admin' }),
      ).rejects.toThrow('Connection timed out');
    });
  });
});
