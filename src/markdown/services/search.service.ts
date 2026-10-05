import { Injectable } from '@nestjs/common';
import { OpenSearchService } from '../../storage/opensearch/opensearch.service.js';
import {
  SearchQueryDto,
  SearchResponseDto,
  SearchResultItemDto,
} from '../dto/search.dto.js';

@Injectable()
export class SearchService {
  constructor(private readonly openSearchService: OpenSearchService) {}

  /**
   * 문서 검색 (OpenSearch 풀텍스트 + 필터 + 스니펫 하이라이트)
   */
  async search(
    ownerId: string,
    query: SearchQueryDto,
  ): Promise<SearchResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const { total, hits } = await this.openSearchService.search({
      query: query.q || '',
      ownerId,
      folderId: query.folderId,
      tag: query.tag,
      offset,
      limit,
    });

    const items = hits.map(
      (hit) =>
        new SearchResultItemDto({
          id: hit.id,
          title: hit.title,
          tags: hit.tags,
          folderId: hit.folderId,
          updatedAt: hit.updatedAt,
          score: hit.score,
          snippet: hit.snippet,
        }),
    );

    return new SearchResponseDto({
      total,
      page,
      limit,
      items,
    });
  }
}
