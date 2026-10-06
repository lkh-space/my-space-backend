import { Injectable, forwardRef, Inject } from '@nestjs/common';
import matter from 'gray-matter';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { DocumentService } from './document.service.js';
import {
  RevisionListItemDto,
  RevisionDetailDto,
  RevisionCompareDto,
} from '../dto/revision.dto.js';
import {
  DocumentNotFoundException,
  RevisionNotFoundException,
} from '../exceptions/markdown.exception.js';

@Injectable()
export class RevisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
    @Inject(forwardRef(() => DocumentService))
    private readonly documentService: DocumentService,
  ) {}

  /**
   * 문서의 리비전 목록 조회 (현재 활성 버전 포함)
   */
  async getRevisions(
    ownerId: string,
    documentId: string,
  ): Promise<RevisionListItemDto[]> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      include: {
        revisions: {
          orderBy: { version: 'desc' },
        },
      },
    });

    if (!doc) {
      throw new DocumentNotFoundException(documentId);
    }

    const items: RevisionListItemDto[] = [
      new RevisionListItemDto({
        version: doc.currentVersion,
        title: doc.title,
        createdAt: doc.updatedAt.toISOString(),
        isCurrent: true,
      }),
    ];

    for (const rev of doc.revisions) {
      items.push(
        new RevisionListItemDto({
          version: rev.version,
          title: rev.title,
          createdAt: rev.createdAt.toISOString(),
          isCurrent: false,
        }),
      );
    }

    return items;
  }

  /**
   * 특정 리비전 버전의 상세 내용 조회
   */
  async getRevisionDetail(
    ownerId: string,
    documentId: string,
    version: number,
  ): Promise<RevisionDetailDto> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
    });

    if (!doc) {
      throw new DocumentNotFoundException(documentId);
    }

    // 요청한 버전이 현재 버전인 경우
    if (version === doc.currentVersion) {
      const raw = await this.minioService.getObjectAsString(
        this.minioService.docsBucket,
        doc.objectKey,
      );
      const parsed = matter(raw);
      return new RevisionDetailDto({
        version: doc.currentVersion,
        title: doc.title,
        content: parsed.content,
        createdAt: doc.updatedAt.toISOString(),
      });
    }

    // 과거 리비전인 경우
    const rev = await this.prisma.documentRevision.findFirst({
      where: { documentId, version },
    });

    if (!rev) {
      throw new RevisionNotFoundException(documentId, version);
    }

    const raw = await this.minioService.getObjectAsString(
      this.minioService.docsBucket,
      rev.objectKey,
    );
    const parsed = matter(raw);

    return new RevisionDetailDto({
      version: rev.version,
      title: rev.title,
      content: parsed.content,
      createdAt: rev.createdAt.toISOString(),
    });
  }

  /**
   * 현재 활성 버전과 특정 과거 버전 간의 내용 비교 데이터 반환
   */
  async compareRevisions(
    ownerId: string,
    documentId: string,
    targetVersion: number,
  ): Promise<RevisionCompareDto> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
    });

    if (!doc) {
      throw new DocumentNotFoundException(documentId);
    }

    const currentRev = await this.getRevisionDetail(
      ownerId,
      documentId,
      doc.currentVersion,
    );
    const targetRev = await this.getRevisionDetail(
      ownerId,
      documentId,
      targetVersion,
    );

    return new RevisionCompareDto({
      baseVersion: currentRev.version,
      baseContent: currentRev.content,
      targetVersion: targetRev.version,
      targetContent: targetRev.content,
    });
  }

  /**
   * 과거 특정 버전으로 문서 복원 (새로운 리비전으로 생성하여 복원)
   */
  async restoreRevision(
    ownerId: string,
    documentId: string,
    version: number,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
    });

    if (!doc) {
      throw new DocumentNotFoundException(documentId);
    }

    if (version === doc.currentVersion) {
      return this.documentService.getDocumentDetail(ownerId, documentId);
    }

    const rev = await this.prisma.documentRevision.findFirst({
      where: { documentId, version },
    });

    if (!rev) {
      throw new RevisionNotFoundException(documentId, version);
    }

    const raw = await this.minioService.getObjectAsString(
      this.minioService.docsBucket,
      rev.objectKey,
    );
    const parsed = matter(raw);

    // 새 리비전으로 updateDocument 수행
    return this.documentService.updateDocument(ownerId, documentId, {
      title: rev.title,
      content: parsed.content,
      frontmatter: parsed.data,
    });
  }
}
