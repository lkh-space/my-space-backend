import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RevisionService } from './revision.service.js';
import { PrismaService } from '../../storage/prisma/prisma.service.js';
import { MinioService } from '../../storage/minio/minio.service.js';
import { DocumentService } from './document.service.js';
import { RevisionNotFoundException } from '../exceptions/markdown.exception.js';

describe('RevisionService', () => {
  let service: RevisionService;
  let prisma: PrismaService;
  let minioService: MinioService;
  let documentService: DocumentService;

  beforeEach(() => {
    prisma = {
      document: {
        findFirst: vi.fn(),
      },
      documentRevision: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    } as unknown as PrismaService;

    minioService = {
      docsBucket: 'my-space-markdown',
      getObjectAsString: vi.fn(),
    } as unknown as MinioService;

    documentService = {
      getDocumentDetail: vi.fn(),
      updateDocument: vi.fn(),
    } as unknown as DocumentService;

    service = new RevisionService(prisma, minioService, documentService);
  });

  describe('getRevisions', () => {
    it('현재 버전과 과거 리비전 목록을 합쳐서 최신순으로 반환해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const documentId = 'doc-1';

      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
        id: documentId,
        title: 'Title v2',
        currentVersion: 2,
        updatedAt: new Date('2026-10-05T10:10:00Z'),
        revisions: [
          {
            id: 'rev-1',
            version: 1,
            title: 'Title v1',
            createdAt: new Date('2026-10-05T10:00:00Z'),
          },
        ],
      } as never);

      // when
      const revisions = await service.getRevisions(ownerId, documentId);

      // then
      expect(revisions).toHaveLength(2);
      expect(revisions[0].version).toBe(2);
      expect(revisions[0].isCurrent).toBe(true);
      expect(revisions[1].version).toBe(1);
      expect(revisions[1].isCurrent).toBe(false);
    });
  });

  describe('getRevisionDetail', () => {
    it('요청 버전이 존재하지 않으면 RevisionNotFoundException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const documentId = 'doc-1';

      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
        id: documentId,
        currentVersion: 2,
      } as never);

      vi.mocked(prisma.documentRevision.findFirst).mockResolvedValueOnce(null);

      // when & then
      await expect(
        service.getRevisionDetail(ownerId, documentId, 999),
      ).rejects.toThrow(RevisionNotFoundException);
    });
  });

  describe('restoreRevision', () => {
    it('과거 버전의 내용을 읽어 새 버전으로 updateDocument를 호출해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const documentId = 'doc-1';
      const targetVersion = 1;

      vi.mocked(prisma.document.findFirst).mockResolvedValueOnce({
        id: documentId,
        currentVersion: 2,
      } as never);

      vi.mocked(prisma.documentRevision.findFirst).mockResolvedValueOnce({
        id: 'rev-1',
        version: 1,
        title: 'Title v1',
        objectKey: 'docs/admin/doc-1/revisions/v1.md',
      } as never);

      vi.mocked(minioService.getObjectAsString).mockResolvedValueOnce(
        '# Old Version 1 Content',
      );

      vi.mocked(documentService.updateDocument).mockResolvedValueOnce({
        id: documentId,
        currentVersion: 3,
        title: 'Title v1',
      } as never);

      // when
      await service.restoreRevision(ownerId, documentId, targetVersion);

      // then
      expect(documentService.updateDocument).toHaveBeenCalledWith(
        ownerId,
        documentId,
        expect.objectContaining({
          title: 'Title v1',
          content: '# Old Version 1 Content',
        }),
      );
    });
  });
});
