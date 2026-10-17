import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchService } from './search.service.js';
import { OpenSearchService } from '@app/storage/opensearch/opensearch.service.js';
import { SearchUnavailableException } from '../exceptions/markdown.exception.js';

describe('SearchService', () => {
  let service: SearchService;
  let openSearchService: OpenSearchService;

  beforeEach(() => {
    openSearchService = {
      search: vi.fn(),
    } as unknown as OpenSearchService;

    service = new SearchService(openSearchService);
  });

  describe('search', () => {
    it('검색 쿼리를 OpenSearchService에 전달하고 결과를 포맷팅하여 반환해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const query = { q: 'NestJS', page: 1, limit: 10 };

      vi.mocked(openSearchService.search).mockResolvedValueOnce({
        total: 1,
        hits: [
          {
            id: 'doc-1',
            title: 'NestJS Guide',
            tags: ['nestjs'],
            folderId: null,
            updatedAt: '2026-10-05T10:00:00Z',
            score: 2.5,
            snippet: '...<em>NestJS</em>...',
          },
        ],
      });

      // when
      const result = await service.search(ownerId, query);

      // then
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('doc-1');
      expect(result.items[0].snippet).toBe('...<em>NestJS</em>...');
      expect(openSearchService.search).toHaveBeenCalledWith({
        query: 'NestJS',
        ownerId,
        folderId: undefined,
        tag: undefined,
        offset: 0,
        limit: 10,
      });
    });

    it('OpenSearch 서비스 장애 발생 시 SearchUnavailableException(503)을 던져야 한다 (장애 은폐 방지)', async () => {
      // given
      const ownerId = 'admin';
      const query = { q: 'NestJS', page: 1, limit: 10 };

      vi.mocked(openSearchService.search).mockRejectedValueOnce(
        new Error('Connection refused at port 9200'),
      );

      // when & then
      await expect(service.search(ownerId, query)).rejects.toThrow(
        SearchUnavailableException,
      );
    });
  });

  describe('searchQuerySchema (M-7 깊은 페이징 상한 검증)', () => {
    it('page * limit가 10,000을 초과하면 유효성 검사에 실패해야 한다', async () => {
      const { searchQuerySchema } = await import('../dto/search.dto.js');

      // given: page = 101, limit = 100 -> 10,100 (> 10000)
      const invalidQuery = { page: 101, limit: 100 };

      // when
      const parsed = searchQuerySchema.safeParse(invalidQuery);

      // then
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toContain('10,000');
      }
    });

    it('page * limit가 10,000 이하이면 정상 통과해야 한다', async () => {
      const { searchQuerySchema } = await import('../dto/search.dto.js');

      // given: page = 100, limit = 100 -> 10,000 (<= 10000)
      const validQuery = { page: 100, limit: 100 };

      // when
      const parsed = searchQuerySchema.safeParse(validQuery);

      // then
      expect(parsed.success).toBe(true);
    });
  });
});
