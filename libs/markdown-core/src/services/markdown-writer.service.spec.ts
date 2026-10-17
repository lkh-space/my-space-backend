import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarkdownWriterService } from './markdown-writer.service.js';
import { FolderNotFoundException } from '@app/common';
import type { PrismaService } from '@app/storage/prisma/prisma.service.js';
import type { MinioService } from '@app/storage/minio/minio.service.js';
import type { OpenSearchService } from '@app/storage/opensearch/opensearch.service.js';
import type { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import type { TagResolverService } from './tag-resolver.service.js';

describe('MarkdownWriterService (BDD 단위 테스트)', () => {
  let service: MarkdownWriterService;
  let mockPrisma: PrismaService;
  let mockMinio: MinioService;
  let mockOpenSearch: OpenSearchService;
  let mockRabbitmq: RabbitmqService;
  let mockTagResolver: TagResolverService;

  beforeEach(() => {
    mockPrisma = {
      folder: {
        findFirst: vi.fn(),
      },
      document: {
        create: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as PrismaService;

    mockMinio = {
      docsBucket: 'test-bucket',
      putObject: vi.fn(),
    } as unknown as MinioService;

    mockOpenSearch = {
      indexDocument: vi.fn(),
    } as unknown as OpenSearchService;

    mockRabbitmq = {
      indexingQueue: 'markdown-indexing-queue',
      publish: vi.fn(),
    } as unknown as RabbitmqService;

    mockTagResolver = {
      resolveTags: vi.fn().mockResolvedValue(['tag-1', 'tag-2']),
    } as unknown as TagResolverService;

    service = new MarkdownWriterService(
      mockPrisma,
      mockMinio,
      mockOpenSearch,
      mockRabbitmq,
      mockTagResolver,
    );
  });

  it('신규 문서를 생성하고 MinIO, DB, OpenSearch, RabbitMQ에 일관되게 기록해야 한다', async () => {
    // given
    const ownerId = 'user-test';
    const now = new Date();
    (mockPrisma.document.create as any).mockResolvedValue({
      id: 'doc-uuid-1',
      title: '테스트 문서',
      folderId: null,
      folder: null,
      createdAt: now,
      updatedAt: now,
    });
    (mockPrisma.document.update as any).mockResolvedValue({
      id: 'doc-uuid-1',
      updatedAt: now,
    });

    // when
    const result = await service.createDocument(ownerId, {
      title: '테스트 문서',
      content: '# 안녕하세요',
      tags: ['guide', 'test'],
    });

    // then
    expect(result.id).toBe('doc-uuid-1');
    expect(result.objectKey).toBe('docs/user-test/doc-uuid-1/current.md');

    // 태그 리졸버 검증
    expect(mockTagResolver.resolveTags).toHaveBeenCalledWith(ownerId, [
      'guide',
      'test',
    ]);

    // MinIO 업로드 검증
    expect(mockMinio.putObject).toHaveBeenCalledWith(
      'test-bucket',
      'docs/user-test/doc-uuid-1/current.md',
      expect.stringContaining('# 안녕하세요'),
    );

    // OpenSearch 전문 색인 검증
    expect(mockOpenSearch.indexDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'doc-uuid-1',
        title: '테스트 문서',
        body: '# 안녕하세요',
        tags: ['guide', 'test'],
        ownerId,
      }),
    );

    // RabbitMQ 인덱싱 이벤트에 objectKey 포함 검증 (H-9 핵심)
    expect(mockRabbitmq.publish).toHaveBeenCalledWith(
      'markdown-indexing-queue',
      expect.objectContaining({
        type: 'INDEX',
        documentId: 'doc-uuid-1',
        ownerId,
        objectKey: 'docs/user-test/doc-uuid-1/current.md',
      }),
    );
  });

  it('존재하지 않거나 타인의 폴더를 지정한 경우 FolderNotFoundException을 던져야 한다', async () => {
    // given
    (mockPrisma.folder.findFirst as any).mockResolvedValue(null);

    // when & then
    await expect(
      service.createDocument('attacker', {
        title: '탈취 문서',
        content: '내용',
        folderId: 'victim-folder',
      }),
    ).rejects.toThrow(FolderNotFoundException);

    expect(mockPrisma.document.create).not.toHaveBeenCalled();
    expect(mockMinio.putObject).not.toHaveBeenCalled();
    expect(mockOpenSearch.indexDocument).not.toHaveBeenCalled();
    expect(mockRabbitmq.publish).not.toHaveBeenCalled();
  });
});
