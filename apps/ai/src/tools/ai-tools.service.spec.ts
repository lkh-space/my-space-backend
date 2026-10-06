import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiToolsService } from './ai-tools.service.js';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@app/storage/prisma/prisma.service.js';
import type { MinioService } from '@app/storage/minio/minio.service.js';
import type { QdrantService } from '@app/storage/qdrant/qdrant.service.js';
import type { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import type { ProviderFactory } from '../providers/provider.factory.js';
import type { EmbeddingProvider } from '../providers/llm.provider.interface.js';

describe('AiToolsService (BDD 단위 테스트)', () => {
  let service: AiToolsService;
  let mockPrisma: PrismaService;
  let mockMinioService: MinioService;
  let mockQdrantService: QdrantService;
  let mockRabbitmqService: RabbitmqService;
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

    mockPrisma = {
      document: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as PrismaService;

    mockMinioService = {
      docsBucket: 'test-docs-bucket',
      getObjectAsString: vi.fn(),
      putObject: vi.fn(),
    } as unknown as MinioService;

    mockQdrantService = {
      searchPoints: vi.fn(),
    } as unknown as QdrantService;

    mockRabbitmqService = {
      indexingQueue: 'markdown-indexing-queue',
      publish: vi.fn(),
    } as unknown as RabbitmqService;

    service = new AiToolsService(
      mockPrisma,
      mockMinioService,
      mockQdrantService,
      mockRabbitmqService,
      mockProviderFactory,
    );
  });

  it('AI가 사용할 수 있는 3개의 필수 도구 명세를 반환한다', () => {
    // given & when
    const tools = service.getToolDefinitions();

    // then
    expect(tools.length).toBe(3);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('search_my_documents');
    expect(toolNames).toContain('read_document');
    expect(toolNames).toContain('save_to_markdown');
  });

  describe('search_my_documents 도구 실행', () => {
    it('일치하는 문서 청크가 있으면 컨텍스트 태그로 감싸서 반환한다', async () => {
      // given
      vi.spyOn(mockQdrantService, 'searchPoints').mockResolvedValue([
        {
          id: 'point-1',
          score: 0.88,
          payload: {
            documentId: 'doc-1',
            title: '테스트 문서',
            heading: '# 서론',
            content: '테스트 본문입니다.',
          },
        },
      ]);

      // when
      const result = await service.executeTool(
        'search_my_documents',
        { query: '테스트 검색', limit: 2 },
        'user-1',
      );

      // then
      expect(result).toContain('<untrusted_document_context>');
      expect(result).toContain('테스트 문서');
      expect(result).toContain('테스트 본문입니다.');
      expect(mockQdrantService.searchPoints).toHaveBeenCalledWith(
        'user-1',
        expect.any(Array),
        2,
      );
    });

    it('검색 결과가 없으면 안내 메시지를 반환한다', async () => {
      // given
      vi.spyOn(mockQdrantService, 'searchPoints').mockResolvedValue([]);

      // when
      const result = await service.executeTool(
        'search_my_documents',
        { query: '없는 내용' },
        'user-1',
      );

      // then
      expect(result).toBe('일치하는 관련 개인 문서를 찾지 못했습니다.');
    });
  });

  describe('read_document 도구 실행', () => {
    it('사용자 소유의 문서 본문을 MinIO에서 읽어 반환한다', async () => {
      // given
      (mockPrisma.document.findFirst as any).mockResolvedValue({
        id: 'doc-10',
        title: '상세 문서',
        objectKey: 'docs/user-1/doc-10/current.md',
      });
      (mockMinioService.getObjectAsString as any).mockResolvedValue('# 문서 전체 내용\n성공');

      // when
      const result = await service.executeTool(
        'read_document',
        { documentId: 'doc-10' },
        'user-1',
      );

      // then
      expect(result).toContain('<untrusted_document_context docId="doc-10" title="상세 문서">');
      expect(result).toContain('# 문서 전체 내용\n성공');
    });

    it('문서가 존재하지 않거나 권한이 없으면 NotFoundException을 던진다', async () => {
      // given
      (mockPrisma.document.findFirst as any).mockResolvedValue(null);

      // when & then
      await expect(
        service.executeTool(
          'read_document',
          { documentId: 'doc-999' },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('save_to_markdown 도구 실행', () => {
    it('문서를 DB에 생성하고 MinIO에 업로드 후 RabbitMQ 인덱싱 이벤트를 발행한다', async () => {
      // given
      (mockPrisma.document.create as any).mockResolvedValue({
        id: 'new-doc-1',
        title: '새 요약 문서',
        folderId: null,
      });
      (mockPrisma.document.update as any).mockResolvedValue({});

      // when
      const result = await service.executeTool(
        'save_to_markdown',
        {
          title: '새 요약 문서',
          content: '## 요약 내용\n훌륭한 결과',
          tags: ['summary'],
        },
        'user-1',
      );

      // then
      expect(mockPrisma.document.create).toHaveBeenCalled();
      expect(mockMinioService.putObject).toHaveBeenCalledWith(
        'test-docs-bucket',
        'docs/user-1/new-doc-1/current.md',
        expect.stringContaining('## 요약 내용'),
      );
      expect(mockRabbitmqService.publish).toHaveBeenCalledWith(
        'markdown-indexing-queue',
        expect.objectContaining({
          type: 'INDEX',
          documentId: 'new-doc-1',
          ownerId: 'user-1',
        }),
      );
      expect(result).toContain('새 요약 문서');
      expect(result).toContain('성공적으로 저장되었습니다');
    });
  });

  it('지원하지 않는 도구 이름 호출 시 NotFoundException을 던진다', async () => {
    // given & when & then
    await expect(
      service.executeTool('unknown_tool', {}, 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });
});
