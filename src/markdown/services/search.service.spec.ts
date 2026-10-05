import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchService } from './search.service.js';
import { OpenSearchService } from '../../storage/opensearch/opensearch.service.js';

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
  });
});
