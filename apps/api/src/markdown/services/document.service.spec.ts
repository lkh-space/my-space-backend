import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentService } from './document.service.js';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { OpenSearchService } from '@app/storage/opensearch/opensearch.service.js';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { TagService } from './tag.service.js';
import {
  DocumentNotFoundException,
  DocumentVersionConflictException,
  InvalidMarkdownFileException,
} from '../exceptions/markdown.exception.js';


describe('DocumentService', () => {
  let service: DocumentService;
  let prisma: PrismaService;
  let minioService: MinioService;
  let openSearchService: OpenSearchService;
  let rabbitmqService: RabbitmqService;
  let tagService: TagService;

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn(async (cb: any) => cb(prisma)),
      folder: { findFirst: vi.fn() },
      document: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
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
      deleteObjects: vi.fn().mockResolvedValue(undefined),
    } as unknown as MinioService;

    openSearchService = {
      indexDocument: vi.fn().mockResolvedValue(undefined),
      deleteDocument: vi.fn().mockResolvedValue(undefined),
    } as unknown as OpenSearchService;

    rabbitmqService = {
      indexingQueue: 'markdown-indexing-queue',
      publish: vi.fn().mockResolvedValue(true),
    } as unknown as RabbitmqService;

    tagService = {
      resolveTags: vi.fn().mockResolvedValue(['t-1']),
    } as unknown as TagService;

    service = new DocumentService(
      prisma,
      minioService,
      openSearchService,
      rabbitmqService,
      tagService,
    );
  });

  describe('createDocument', () => {
    it('새 문서를 정상적으로 생성하고 MinIO 선행 저장, 원자적 DB 생성 및 OpenSearch 색인을 수행해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const dto = {
        title: 'NestJS Guide',
        content: '# Hello NestJS',
        tags: ['nestjs'],
      };

      vi.mocked(prisma.document.create).mockImplementation((async (args: any) => ({
        id: args.data.id,
        title: args.data.title,
        folderId: null,
        ownerId,
        currentVersion: 1,
        objectKey: args.data.objectKey,
        createdAt: new Date('2026-10-05T10:00:00Z'),
        updatedAt: new Date('2026-10-05T10:00:00Z'),
        folder: null,
      })) as any);

      // when
      const result = await service.createDocument(ownerId, dto);

      // then
      expect(result.id).toBeDefined();
      expect(result.title).toBe('NestJS Guide');
      expect(result.currentVersion).toBe(1);
      expect(minioService.putObject).toHaveBeenCalledWith(
        'my-space-markdown',
        `docs/admin/${result.id}/current.md`,
        expect.stringContaining('# Hello NestJS'),
      );
      expect(openSearchService.indexDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          id: result.id,
          title: 'NestJS Guide',
        }),
      );
    });

    it('DB 트랜잭션 실패 시 MinIO 선행 저장 파일을 보상 삭제(롤백)해야 한다 (M-2 원자성)', async () => {
      // given
      const ownerId = 'admin';
      const dto = {
        title: 'Failed Document',
        content: '# Will Fail',
      };

      vi.mocked(prisma.document.create).mockRejectedValueOnce(
        new Error('DB Unique Constraint Error'),
      );

      // when & then
      await expect(service.createDocument(ownerId, dto)).rejects.toThrow(
        'DB Unique Constraint Error',
      );

      expect(minioService.putObject).toHaveBeenCalled();
      expect(minioService.deleteObject).toHaveBeenCalledWith(
        'my-space-markdown',
        expect.stringMatching(/^docs\/admin\/.+\/current\.md$/),
      );
    });
  });

  describe('getDocuments (M-6 페이징 및 복합 인덱스 지원)', () => {
    it('기본 오프셋 페이징으로 문서 목록 및 nextCursor를 올바르게 반환해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const mockDocs = [
        {
          id: 'doc-1',
          title: '문서 1',
          folderId: null,
          folder: null,
          tags: [{ tag: { name: 'nestjs' } }],
          currentVersion: 1,
          createdAt: new Date('2026-10-05T10:00:00Z'),
          updatedAt: new Date('2026-10-05T10:00:00Z'),
        },
      ];

      vi.mocked(prisma.document.count).mockResolvedValueOnce(1);
      vi.mocked(prisma.document.findMany).mockResolvedValueOnce(mockDocs as never);

      // when
      const result = await service.getDocuments(ownerId, { page: 1, limit: 1 });

      // then
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('doc-1');
      expect(result.nextCursor).toBe('doc-1');
      expect(prisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ownerId },
          take: 1,
          skip: 0,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('cursor가 주어지면 cursor 기반 페이징(skip: 1)으로 쿼리를 수행해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const cursorId = 'doc-1';
      const mockDocs = [
        {
          id: 'doc-2',
          title: '문서 2',
          folderId: null,
          folder: null,
          tags: [],
          currentVersion: 1,
          createdAt: new Date('2026-10-05T11:00:00Z'),
          updatedAt: new Date('2026-10-05T11:00:00Z'),
        },
      ];

      vi.mocked(prisma.document.count).mockResolvedValueOnce(2);
      vi.mocked(prisma.document.findMany).mockResolvedValueOnce(mockDocs as never);

      // when
      const result = await service.getDocuments(ownerId, { cursor: cursorId, limit: 1 });

      // then
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('doc-2');
      expect(result.nextCursor).toBe('doc-2');
      expect(prisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ownerId },
          cursor: { id: cursorId },
          skip: 1,
          take: 1,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
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

  describe('updateDocument (M-3 낙관적 동시성 잠금)', () => {
    it('본문이 수정되면 이전 버전을 리비전으로 저장하고 낙관적 잠금으로 버전을 1 증가시켜야 한다', async () => {
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

      vi.mocked(prisma.document.updateMany).mockResolvedValueOnce({
        count: 1,
      });

      vi.mocked(prisma.document.findUniqueOrThrow).mockResolvedValueOnce({
        id: documentId,
        title: 'Old Title',
        folderId: null,
        ownerId,
        objectKey: 'docs/admin/doc-1/current.md',
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
      expect(prisma.document.updateMany).toHaveBeenCalledWith({
        where: { id: documentId, ownerId, currentVersion: 1 },
        data: expect.objectContaining({ currentVersion: 2 }),
      });
      expect(prisma.documentRevision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentId,
          version: 1,
          objectKey: 'docs/admin/doc-1/revisions/v1.md',
        }),
      });
    });

    it('수정 요청 시 기대 버전(expectedVersion)과 DB 현재 버전이 다르면 DocumentVersionConflictException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const documentId = 'doc-1';
      const dto = { content: '# New' };
      const expectedVersion = 2; // 클라이언트는 v2를 보냈으나

      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
        id: documentId,
        title: 'Title',
        folderId: null,
        objectKey: 'docs/admin/doc-1/current.md',
        currentVersion: 3, // DB는 이미 v3임
        tags: [],
      } as never);

      // when & then
      await expect(
        service.updateDocument(ownerId, documentId, dto, expectedVersion),
      ).rejects.toThrow(DocumentVersionConflictException);

      expect(minioService.putObject).not.toHaveBeenCalled();
      expect(prisma.document.updateMany).not.toHaveBeenCalled();
    });

    it('동시 수정 경쟁 조건으로 updateMany 갱신 건수가 0이면 409 예외를 던지고 MinIO를 보상 롤백해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const documentId = 'doc-1';
      const dto = { content: '# Race Update' };

      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
        id: documentId,
        title: 'Title',
        folderId: null,
        objectKey: 'docs/admin/doc-1/current.md',
        currentVersion: 1,
        tags: [],
      } as never);

      vi.mocked(minioService.getObjectAsString).mockResolvedValueOnce(
        '# Original Content',
      );

      // 다른 트랜잭션이 먼저 버전을 올려서 count가 0이 됨
      vi.mocked(prisma.document.updateMany).mockResolvedValueOnce({
        count: 0,
      });

      // when & then
      await expect(
        service.updateDocument(ownerId, documentId, dto, 1),
      ).rejects.toThrow(DocumentVersionConflictException);

      // MinIO 보상 롤백 검증: 최신 본문을 원본으로 복구하고 임시 revision 객체 삭제
      expect(minioService.putObject).toHaveBeenCalledWith(
        'my-space-markdown',
        'docs/admin/doc-1/current.md',
        '# Original Content',
      );
      expect(minioService.deleteObject).toHaveBeenCalledWith(
        'my-space-markdown',
        'docs/admin/doc-1/revisions/v1.md',
      );
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

      vi.mocked(prisma.document.create).mockImplementation((async (args: any) => ({
        id: 'doc-imported',
        title: args.data.title,
        folderId: null,
        ownerId,
        currentVersion: 1,
        objectKey: args.data.objectKey,
        createdAt: new Date('2026-10-05T10:00:00Z'),
        updatedAt: new Date('2026-10-05T10:00:00Z'),
        folder: null,
      })) as any);

      // when
      const result = await service.importMarkdown(ownerId, file);

      // then
      expect(result.id).toBe('doc-imported');
      expect(result.title).toBe('Imported Document');
      expect(result.tags).toEqual(['nestjs', 'test']);
    });

    it('.md 파일이 전달되지 않거나 버퍼가 비어있으면 InvalidMarkdownFileException을 던져야 한다 (L-2)', async () => {
      // given
      const ownerId = 'admin';

      // when & then
      await expect(service.importMarkdown(ownerId, undefined)).rejects.toThrow(
        InvalidMarkdownFileException,
      );

      const emptyFile = {
        buffer: Buffer.from(''),
      } as Express.Multer.File;

      await expect(service.importMarkdown(ownerId, emptyFile)).rejects.toThrow(
        InvalidMarkdownFileException,
      );
    });
  });


  describe('deleteDocument (M-2 DB 선행 삭제 원자성)', () => {
    it('문서 삭제 시 DB 레코드를 먼저 삭제하고 이후 MinIO 객체(최신+리비전 일괄) 및 OpenSearch 색인을 정리해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const documentId = 'doc-1';
      const callOrder: string[] = [];

      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
        id: documentId,
        ownerId,
        objectKey: 'docs/admin/doc-1/current.md',
        revisions: [{ objectKey: 'docs/admin/doc-1/revisions/v1.md' }],
      } as never);

      vi.mocked(prisma.document.delete).mockImplementation((async () => {
        callOrder.push('DB_DELETE');
        return {} as never;
      }) as any);

      vi.mocked(minioService.deleteObjects).mockImplementation(async () => {
        callOrder.push('MINIO_DELETE');
      });

      vi.mocked(openSearchService.deleteDocument).mockImplementation(async () => {
        callOrder.push('OPENSEARCH_DELETE');
      });

      // when
      await service.deleteDocument(ownerId, documentId);

      // then: DB 삭제가 MinIO 및 OpenSearch보다 항상 먼저 실행되어야 함
      expect(callOrder[0]).toBe('DB_DELETE');
      expect(callOrder).toContain('MINIO_DELETE');
      expect(callOrder).toContain('OPENSEARCH_DELETE');
      expect(minioService.deleteObjects).toHaveBeenCalledWith(
        'my-space-markdown',
        ['docs/admin/doc-1/current.md', 'docs/admin/doc-1/revisions/v1.md'],
      );
      expect(rabbitmqService.publish).toHaveBeenCalledWith(
        'markdown-indexing-queue',
        expect.objectContaining({ type: 'DELETE', documentId }),
      );
    });

    it('DB 삭제가 실패하면 MinIO 객체는 안전하게 보존되어야 한다', async () => {
      // given
      const ownerId = 'admin';
      const documentId = 'doc-1';

      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
        id: documentId,
        ownerId,
        objectKey: 'docs/admin/doc-1/current.md',
        revisions: [],
      } as never);

      vi.mocked(prisma.document.delete).mockRejectedValueOnce(
        new Error('DB Foreign Key Conflict'),
      );

      // when & then
      await expect(
        service.deleteDocument(ownerId, documentId),
      ).rejects.toThrow('DB Foreign Key Conflict');

      expect(minioService.deleteObjects).not.toHaveBeenCalled();
      expect(openSearchService.deleteDocument).not.toHaveBeenCalled();
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

  describe('exportPdf', () => {
    it('긴 텍스트와 여러 헤더가 포함된 문서를 동적 줄바꿈 및 페이지네이션을 거쳐 PDF 버퍼로 정상 생성해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const documentId = 'doc-pdf-1';

      // 100자가 넘는 긴 문장과 다단계 헤더
      const longText = 'This is a very long line of text intended to test the dynamic line wrapping capability of the PDF export service. '.repeat(5);
      const markdownContent = `# Main Title\n## Sub Title\n${longText}\n\nAnother paragraph with multiple words.`;

      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
        id: documentId,
        title: 'Project/Spec/Report',
        currentVersion: 2,
        folderId: null,
        ownerId,
        objectKey: 'docs/admin/doc-pdf-1/current.md',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        updatedAt: new Date('2026-10-05T12:00:00Z'),
        tags: [],
        folder: null,
      } as never);

      vi.mocked(minioService.getObjectAsString).mockResolvedValueOnce(markdownContent);

      // when
      const result = await service.exportPdf(ownerId, documentId);

      // then
      expect(result.filename).toBe('Project_Spec_Report.pdf');
      expect(result.buffer).toBeDefined();
      expect(result.buffer.length).toBeGreaterThan(100);

      // PDF 매직 바이트 검증 (%PDF-)
      const pdfHeader = Buffer.from(result.buffer.slice(0, 5)).toString('utf-8');
      expect(pdfHeader).toBe('%PDF-');
    });
  });
});
