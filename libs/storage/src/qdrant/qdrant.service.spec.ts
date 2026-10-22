import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QdrantService } from './qdrant.service.js';
import type { ConfigService } from '@nestjs/config';

describe('QdrantService (BDD 단위 테스트 M-11)', () => {
  let service: QdrantService;
  let mockConfigService: ConfigService;
  let mockQdrantClient: any;

  beforeEach(() => {
    mockConfigService = {
      get: vi.fn((key: string, defaultValue?: any) => {
        if (key === 'qdrant.url') return 'http://localhost:6333';
        if (key === 'qdrant.apiKey') return 'mock-key';
        if (key === 'qdrant.collection') return 'personal-documents';
        return defaultValue;
      }),
    } as unknown as ConfigService;

    service = new QdrantService(mockConfigService);

    mockQdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue({}),
      createPayloadIndex: vi.fn().mockResolvedValue({}),
      getCollection: vi.fn().mockResolvedValue({
        config: {
          params: {
            vectors: {
              size: 768,
              distance: 'Cosine',
            },
          },
        },
      }),
      upsert: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      scroll: vi.fn().mockResolvedValue({ points: [] }),
      query: vi.fn().mockResolvedValue({ points: [] }),
    };

    (service as any).client = mockQdrantClient;
  });

  describe('ensureCollection (컬렉션 보장 및 메타데이터 검증)', () => {
    it('컬렉션이 존재하지 않으면 768차원 Cosine 컬렉션과 embeddingModel 포함 페이로드 인덱스를 신규 생성한다', async () => {
      // given
      mockQdrantClient.getCollections.mockResolvedValueOnce({ collections: [] });

      // when
      await service.ensureCollection();

      // then
      expect(mockQdrantClient.createCollection).toHaveBeenCalledWith(
        'personal-documents',
        {
          vectors: {
            size: 768,
            distance: 'Cosine',
          },
        },
      );
      expect(mockQdrantClient.createPayloadIndex).toHaveBeenCalledWith(
        'personal-documents',
        expect.objectContaining({ field_name: 'embeddingModel', field_schema: 'keyword' }),
      );
      expect(mockQdrantClient.createPayloadIndex).toHaveBeenCalledWith(
        'personal-documents',
        expect.objectContaining({ field_name: 'ownerId', field_schema: 'keyword' }),
      );
    });

    it('컬렉션이 이미 존재하면 기존 벡터 차원과 거리 함수를 검증한다', async () => {
      // given
      mockQdrantClient.getCollections.mockResolvedValueOnce({
        collections: [{ name: 'personal-documents' }],
      });
      mockQdrantClient.getCollection.mockResolvedValueOnce({
        config: {
          params: {
            vectors: {
              size: 768,
              distance: 'Cosine',
            },
          },
        },
      });

      // when
      await service.ensureCollection();

      // then
      expect(mockQdrantClient.createCollection).not.toHaveBeenCalled();
      expect(mockQdrantClient.getCollection).toHaveBeenCalledWith('personal-documents');
    });

    it('기존 컬렉션의 벡터 차원이 768이 아니면 에러를 로깅한다', async () => {
      // given
      const loggerSpy = vi.spyOn((service as any).logger, 'error');
      mockQdrantClient.getCollections.mockResolvedValueOnce({
        collections: [{ name: 'personal-documents' }],
      });
      mockQdrantClient.getCollection.mockResolvedValueOnce({
        config: {
          params: {
            vectors: {
              size: 1536, // OpenAI 차원 등 불일치 상황
              distance: 'Cosine',
            },
          },
        },
      });

      // when
      await service.ensureCollection();

      // then
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('벡터 차원(1536)이 시스템 설정(768)과 불일치합니다'),
      );
    });
  });

  describe('searchPoints (시맨틱 검색 필터링)', () => {
    it('embeddingModel이 옵션으로 전달되면 mustFilters에 embeddingModel 필터를 적용한다', async () => {
      // given
      const vector = Array.from({ length: 768 }, () => 0.05);
      mockQdrantClient.query.mockResolvedValueOnce({
        points: [
          {
            id: 'p1',
            score: 0.92,
            payload: {
              ownerId: 'user-1',
              documentId: 'doc-1',
              chunkIndex: 0,
              title: '테스트',
              heading: '소개',
              content: '본문',
              embeddingModel: 'gemini-embedding-001',
            },
          },
        ],
      });

      // when
      const results = await service.searchPoints('user-1', vector, 5, {
        folderId: 'folder-1',
        tags: ['ai'],
        embeddingModel: 'gemini-embedding-001',
      });

      // then
      expect(mockQdrantClient.query).toHaveBeenCalledWith(
        'personal-documents',
        expect.objectContaining({
          query: vector,
          limit: 5,
          filter: {
            must: [
              { key: 'ownerId', match: { value: 'user-1' } },
              { key: 'embeddingModel', match: { value: 'gemini-embedding-001' } },
              { key: 'folderId', match: { value: 'folder-1' } },
              { key: 'tags', match: { value: 'ai' } },
            ],
          },
        }),
      );
      expect(results).toHaveLength(1);
      expect(results[0].payload.embeddingModel).toBe('gemini-embedding-001');
    });
  });
});
