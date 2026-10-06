import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiSearchService } from './ai-search.service.js';
import type { QdrantService } from '@app/storage/qdrant/qdrant.service.js';
import type { ProviderFactory } from '../providers/provider.factory.js';
import type { EmbeddingProvider } from '../providers/llm.provider.interface.js';

describe('AiSearchService (BDD 단위 테스트)', () => {
  let service: AiSearchService;
  let mockQdrantService: QdrantService;
  let mockProviderFactory: ProviderFactory;
  let mockEmbeddingProvider: EmbeddingProvider;

  beforeEach(() => {
    mockEmbeddingProvider = {
      name: 'gemini',
      dimension: 768,
      embedText: vi
        .fn()
        .mockResolvedValue(Array.from({ length: 768 }, () => 0.1)),
      embedBatch: vi.fn(),
    };

    mockProviderFactory = {
      getEmbeddingProvider: vi.fn().mockReturnValue(mockEmbeddingProvider),
      getLlmProvider: vi.fn(),
    } as unknown as ProviderFactory;

    mockQdrantService = {
      searchPoints: vi.fn().mockResolvedValue([
        {
          id: 'point-1',
          score: 0.89123,
          payload: {
            documentId: 'doc-123',
            ownerId: 'user-1',
            title: 'NestJS 아키텍처',
            heading: '# 모듈 구조',
            content: 'NestJS는 모듈 기반의 백엔드 프레임워크입니다.',
            tags: ['nestjs', 'backend'],
            chunkIndex: 0,
            version: 1,
          },
        },
      ]),
    } as unknown as QdrantService;

    service = new AiSearchService(mockQdrantService, mockProviderFactory);
  });

  it('사용자 질의어를 임베딩하고 Qdrant 검색 결과를 DTO 형식으로 변환하여 반환한다', async () => {
    // given
    const ownerId = 'user-1';
    const queryDto = { query: 'NestJS 아키텍처', limit: 3 };

    // when
    const response = await service.search(ownerId, queryDto);

    // then
    expect(mockEmbeddingProvider.embedText).toHaveBeenCalledWith('NestJS 아키텍처');
    expect(mockQdrantService.searchPoints).toHaveBeenCalledWith(
      ownerId,
      expect.any(Array),
      3,
      { folderId: undefined, tags: undefined },
    );
    expect(response.total).toBe(1);
    expect(response.results[0]).toEqual({
      documentId: 'doc-123',
      title: 'NestJS 아키텍처',
      heading: '# 모듈 구조',
      content: 'NestJS는 모듈 기반의 백엔드 프레임워크입니다.',
      score: 0.8912,
      tags: ['nestjs', 'backend'],
    });
  });

  it('폴더 및 태그 필터가 주어지면 Qdrant 검색 옵션에 포함하여 필터링한다', async () => {
    // given
    const ownerId = 'user-1';
    const queryDto = {
      query: '문서 검색',
      folderId: 'folder-abc',
      tags: ['guide'],
    };

    // when
    await service.search(ownerId, queryDto);

    // then
    expect(mockQdrantService.searchPoints).toHaveBeenCalledWith(
      ownerId,
      expect.any(Array),
      5, // 기본 limit
      { folderId: 'folder-abc', tags: ['guide'] },
    );
  });
});
