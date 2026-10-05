import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentService } from './document.service.js';
import { PrismaService } from '../../storage/prisma/prisma.service.js';
import { MinioService } from '../../storage/minio/minio.service.js';
import { OpenSearchService } from '../../storage/opensearch/opensearch.service.js';
import { TagService } from './tag.service.js';
import { DocumentNotFoundException } from '../exceptions/markdown.exception.js';

describe('DocumentService', () => {
  let service: DocumentService;
  let prisma: PrismaService;
  let minioService: MinioService;
  let openSearchService: OpenSearchService;
  let tagService: TagService;

  beforeEach(() => {
    prisma = {
      folder: { findFirst: vi.fn() },
      document: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      documentTag: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      documentRevision: {
        create: vi.fn(),
      },
    } as unknown as PrismaService;

    minioService = {
      docsBucket: 'my-space-markdown',
      putObject: vi.fn().mockResolvedValue(undefined),
      getObjectAsString: vi.fn(),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    } as unknown as MinioService;

    openSearchService = {
      indexDocument: vi.fn().mockResolvedValue(undefined),
      deleteDocument: vi.fn().mockResolvedValue(undefined),
    } as unknown as OpenSearchService;

    tagService = {
      resolveTags: vi.fn().mockResolvedValue(['t-1']),
    } as unknown as TagService;

    service = new DocumentService(
      prisma,
      minioService,
      openSearchService,
      tagService,
    );
  });

  describe('createDocument', () => {
    it('새 문서를 정상적으로 생성하고 MinIO 저장 및 OpenSearch 색인을 수행해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const dto = {
        title: 'NestJS Guide',
        content: '# Hello NestJS',
        tags: ['nestjs'],
      };

      vi.mocked(prisma.document.create).mockResolvedValueOnce({
        id: 'doc-1',
        title: dto.title,
        folderId: null,
        ownerId,
        currentVersion: 1,
        objectKey: '',
        createdAt: new Date('2026-10-05T10:00:00Z'),
        updatedAt: new Date('2026-10-05T10:00:00Z'),
        folder: null,
      } as never);

      vi.mocked(prisma.document.update).mockResolvedValueOnce({} as never);

      // when
      const result = await service.createDocument(ownerId, dto);

      // then
      expect(result.id).toBe('doc-1');
      expect(result.title).toBe('NestJS Guide');
      expect(result.currentVersion).toBe(1);
      expect(minioService.putObject).toHaveBeenCalledWith(
        'my-space-markdown',
        'docs/admin/doc-1/current.md',
        expect.stringContaining('# Hello NestJS'),
      );
      expect(openSearchService.indexDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'doc-1',
          title: 'NestJS Guide',
        }),
      );
    });
  });

  describe('getDocumentDetail', () => {
    it('문서가 존재하면 MinIO 본문과 결합하여 정상 반환해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const documentId = 'doc-1';

      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
        id: documentId,
        title: 'NestJS Guide',
        folderId: null,
        objectKey: 'docs/admin/doc-1/current.md',
        currentVersion: 1,
        createdAt: new Date('2026-10-05T10:00:00Z'),
        updatedAt: new Date('2026-10-05T10:00:00Z'),
        folder: null,
        tags: [{ tag: { name: 'nestjs' } }],
      } as never);

      vi.mocked(minioService.getObjectAsString).mockResolvedValueOnce(
        '---\nauthor: Keunhyeok\n---\n# Hello NestJS',
      );

      // when
      const result = await service.getDocumentDetail(ownerId, documentId);

      // then
      expect(result.id).toBe(documentId);
      expect(result.content.trim()).toBe('# Hello NestJS');
      expect(result.frontmatter).toEqual({ author: 'Keunhyeok' });
      expect(result.tags).toEqual(['nestjs']);
    });

    it('존재하지 않는 문서 조회 시 DocumentNotFoundException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce(null);

      // when & then
      await expect(
        service.getDocumentDetail(ownerId, 'non-existent'),
      ).rejects.toThrow(DocumentNotFoundException);
    });
  });

  describe('updateDocument', () => {
    it('본문이 수정되면 이전 버전을 리비전으로 저장하고 버전을 1 증가시켜야 한다', async () => {
      // given
      const ownerId = 'admin';
      const documentId = 'doc-1';
      const dto = { content: '# Updated Content' };

      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
        id: documentId,
        title: 'Old Title',
        folderId: null,
        objectKey: 'docs/admin/doc-1/current.md',
        currentVersion: 1,
        createdAt: new Date('2026-10-05T10:00:00Z'),
        updatedAt: new Date('2026-10-05T10:00:00Z'),
        folder: null,
        tags: [],
      } as never);

      vi.mocked(minioService.getObjectAsString).mockResolvedValueOnce(
        '# Old Content',
      );

      vi.mocked(prisma.document.update).mockResolvedValueOnce({
        id: documentId,
        title: 'Old Title',
        folderId: null,
        currentVersion: 2,
        createdAt: new Date('2026-10-05T10:00:00Z'),
        updatedAt: new Date('2026-10-05T10:05:00Z'),
        folder: null,
      } as never);

      // when
      const result = await service.updateDocument(ownerId, documentId, dto);

      // then
      expect(result.currentVersion).toBe(2);
      expect(minioService.putObject).toHaveBeenCalledWith(
        'my-space-markdown',
        'docs/admin/doc-1/revisions/v1.md',
        '# Old Content',
      );
      expect(prisma.documentRevision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentId,
          version: 1,
          objectKey: 'docs/admin/doc-1/revisions/v1.md',
        }),
      });
    });
  });

  describe('importMarkdown', () => {
    it('.md 파일 업로드 시 frontmatter와 제목을 추출하여 문서를 정상 생성해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const mdContent = '---\ntitle: Imported Document\ntags: [nestjs, test]\n---\n# Main Header\n\nContent here';
      const file: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test-doc.md',
        encoding: '7bit',
        mimetype: 'text/markdown',
        buffer: Buffer.from(mdContent),
        size: Buffer.from(mdContent).length,
        destination: '',
        filename: '',
        path: '',
        stream: null as never,
      };

      vi.mocked(prisma.document.create).mockResolvedValueOnce({
        id: 'doc-imported',
        title: 'Imported Document',
        folderId: null,
        ownerId,
        currentVersion: 1,
        objectKey: '',
        createdAt: new Date('2026-10-05T10:00:00Z'),
        updatedAt: new Date('2026-10-05T10:00:00Z'),
        folder: null,
      } as never);
      vi.mocked(prisma.document.update).mockResolvedValueOnce({} as never);

      // when
      const result = await service.importMarkdown(ownerId, file);

      // then
      expect(result.id).toBe('doc-imported');
      expect(result.title).toBe('Imported Document');
      expect(result.tags).toEqual(['nestjs', 'test']);
    });
  });

  describe('exportMarkdown', () => {
    it('문서가 존재하면 원문 내용과 안전한 파일명을 반환해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const documentId = 'doc-1';

      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
        id: documentId,
        title: 'Test/Document',
        objectKey: 'docs/admin/doc-1/current.md',
      } as never);

      vi.mocked(minioService.getObjectAsString).mockResolvedValueOnce(
        '# Markdown Content',
      );

      // when
      const result = await service.exportMarkdown(ownerId, documentId);

      // then
      expect(result.filename).toBe('Test_Document.md');
      expect(result.content).toBe('# Markdown Content');
    });
  });
});
