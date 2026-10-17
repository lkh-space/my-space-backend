import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { safeMatter } from '@app/common/markdown/safe-matter.js';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { OpenSearchService } from '@app/storage/opensearch/opensearch.service.js';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { TagService } from './tag.service.js';
import {
  CreateDocumentDto,
  UpdateDocumentDto,
  DocumentQueryDto,
  DocumentListItemDto,
  DocumentDetailDto,
} from '../dto/document.dto.js';
import {
  DocumentNotFoundException,
  FolderNotFoundException,
  DocumentVersionConflictException,
} from '../exceptions/markdown.exception.js';

@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
    private readonly openSearchService: OpenSearchService,
    private readonly rabbitmqService: RabbitmqService,
    private readonly tagService: TagService,
  ) {}

  /**
   * 신규 문서 생성 (원자적 다단계 쓰기 보장)
   */
  async createDocument(
    ownerId: string,
    dto: CreateDocumentDto,
  ): Promise<DocumentDetailDto> {
    const folderId = dto.folderId || null;

    if (folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: folderId, ownerId },
      });
      if (!folder) {
        throw new FolderNotFoundException(folderId);
      }
    }

    // Frontmatter와 본문 결합
    const frontmatter = dto.frontmatter || {};
    const content = dto.content || '';
    const rawMarkdown = safeMatter.stringify(content, frontmatter);

    // 식별자 및 오브젝트 키 사전 계산
    const id = randomUUID();
    const objectKey = `docs/${ownerId}/${id}/current.md`;
    const tagNames = dto.tags || [];

    // 1. MinIO에 먼저 저장 (MinIO 실패 시 DB에는 아무런 레코드도 남지 않음)
    await this.minioService.putObject(
      this.minioService.docsBucket,
      objectKey,
      rawMarkdown,
    );

    let created: any;
    try {
      // 2. DB 레코드와 태그 관계를 단일 트랜잭션으로 원자적 생성
      created = await this.prisma.$transaction(async (tx) => {
        const tagIds = await this.tagService.resolveTags(ownerId, tagNames, tx);
        return tx.document.create({
          data: {
            id,
            title: dto.title,
            folderId,
            ownerId,
            currentVersion: 1,
            objectKey,
            tags: {
              create: tagIds.map((tagId) => ({ tagId })),
            },
          },
          include: {
            folder: { select: { name: true } },
          },
        });
      });
    } catch (err) {
      // DB 트랜잭션 실패 시 MinIO 선행 저장 객체 즉시 보상 삭제
      await this.minioService
        .deleteObject(this.minioService.docsBucket, objectKey)
        .catch(() => {});
      throw err;
    }

    // OpenSearch 비동기 색인
    await this.openSearchService.indexDocument({
      id: created.id,
      title: created.title,
      body: content,
      tags: tagNames,
      folderId: created.folderId,
      ownerId,
      updatedAt: created.updatedAt.toISOString(),
    });

    // RabbitMQ 비동기 벡터 인덱싱 이벤트 발행
    await this.rabbitmqService.publish(this.rabbitmqService.indexingQueue, {
      type: 'INDEX',
      documentId: created.id,
      ownerId,
      version: 1,
      objectKey,
      title: created.title,
      folderId: created.folderId,
      tags: tagNames,
      timestamp: new Date().toISOString(),
    });

    return new DocumentDetailDto({
      id: created.id,
      title: created.title,
      folderId: created.folderId,
      folderName: created.folder?.name || null,
      tags: tagNames,
      currentVersion: 1,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
      content,
      frontmatter,
    });
  }

  /**
   * 문서 목록 조회 (페이징, 폴더, 태그 필터링)
   */
  async getDocuments(
    ownerId: string,
    query: DocumentQueryDto,
  ): Promise<{ total: number; page: number; limit: number; items: DocumentListItemDto[] }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { ownerId };

    if (query.folderId) {
      where.folderId = query.folderId;
    }

    if (query.tag) {
      where.tags = {
        some: {
          tag: {
            name: query.tag.toLowerCase(),
            ownerId,
          },
        },
      };
    }

    const [total, documents] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          folder: { select: { name: true } },
          tags: {
            select: {
              tag: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    const items = documents.map(
      (doc: any) =>
        new DocumentListItemDto({
          id: doc.id,
          title: doc.title,
          folderId: doc.folderId,
          folderName: doc.folder?.name || null,
          tags: doc.tags.map((t: any) => t.tag.name),
          currentVersion: doc.currentVersion,
          createdAt: doc.createdAt.toISOString(),
          updatedAt: doc.updatedAt.toISOString(),
        }),
    );

    return { total, page, limit, items };
  }

  /**
   * 문서 상세 조회 (메타데이터 + MinIO 본문 로드)
   */
  async getDocumentDetail(
    ownerId: string,
    documentId: string,
  ): Promise<DocumentDetailDto> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      include: {
        folder: { select: { name: true } },
        tags: {
          select: {
            tag: { select: { name: true } },
          },
        },
      },
    });

    if (!doc) {
      throw new DocumentNotFoundException(documentId);
    }

    // MinIO에서 원문 읽기
    const rawMarkdown = await this.minioService.getObjectAsString(
      this.minioService.docsBucket,
      doc.objectKey,
    );

    const parsed = safeMatter(rawMarkdown);

    return new DocumentDetailDto({
      id: doc.id,
      title: doc.title,
      folderId: doc.folderId,
      folderName: doc.folder?.name || null,
      tags: doc.tags.map((t: any) => t.tag.name),
      currentVersion: doc.currentVersion,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      content: parsed.content,
      frontmatter: parsed.data,
    });
  }

  /**
   * 문서 수정 (내용 변경 시 리비전 보존 및 새 버전 생성, 낙관적 잠금 지원)
   */
  async updateDocument(
    ownerId: string,
    documentId: string,
    dto: UpdateDocumentDto,
    expectedVersion?: number,
  ): Promise<DocumentDetailDto> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      include: {
        folder: { select: { name: true } },
        tags: {
          select: {
            tag: { select: { name: true } },
          },
        },
      },
    });

    if (!doc) {
      throw new DocumentNotFoundException(documentId);
    }

    // 낙관적 동시성 검증: 클라이언트의 기대 버전과 DB 현재 버전 대조
    if (
      expectedVersion !== undefined &&
      doc.currentVersion !== expectedVersion
    ) {
      throw new DocumentVersionConflictException(
        doc.id,
        expectedVersion,
        doc.currentVersion,
      );
    }

    // 폴더 변경 시 유효성 검증
    if (dto.folderId !== undefined && dto.folderId !== doc.folderId) {
      if (dto.folderId !== null) {
        const folder = await this.prisma.folder.findFirst({
          where: { id: dto.folderId, ownerId },
        });
        if (!folder) {
          throw new FolderNotFoundException(dto.folderId);
        }
      }
    }

    // 기존 MinIO 원문 읽기
    const oldRaw = await this.minioService.getObjectAsString(
      this.minioService.docsBucket,
      doc.objectKey,
    );
    const oldParsed = safeMatter(oldRaw);

    const newContent =
      dto.content !== undefined ? dto.content : oldParsed.content;
    const newFrontmatter =
      dto.frontmatter !== undefined ? dto.frontmatter : oldParsed.data;
    const newTitle = dto.title !== undefined ? dto.title : doc.title;
    const newFolderId =
      dto.folderId !== undefined ? dto.folderId : doc.folderId;

    const isContentChanged =
      dto.content !== undefined && dto.content !== oldParsed.content;
    const isFrontmatterChanged =
      dto.frontmatter !== undefined &&
      JSON.stringify(dto.frontmatter) !== JSON.stringify(oldParsed.data);
    const isTitleChanged = dto.title !== undefined && dto.title !== doc.title;

    const isModified =
      isContentChanged || isFrontmatterChanged || isTitleChanged;
    let nextVersion = doc.currentVersion;
    const revisionKey = `docs/${ownerId}/${doc.id}/revisions/v${doc.currentVersion}.md`;
    let newRaw = '';

    // 본문이나 제목, 메타데이터에 실제 변경이 있는 경우
    if (isModified) {
      // 1. 현재 버전을 리비전 경로로 복사 저장
      await this.minioService.putObject(
        this.minioService.docsBucket,
        revisionKey,
        oldRaw,
      );

      // 2. 최신 본문 MinIO 갱신
      newRaw = safeMatter.stringify(newContent, newFrontmatter);
      await this.minioService.putObject(
        this.minioService.docsBucket,
        doc.objectKey,
        newRaw,
      );

      nextVersion = doc.currentVersion + 1;
    }

    let activeTagNames = doc.tags.map((t: any) => t.tag.name);
    if (dto.tags !== undefined) {
      activeTagNames = dto.tags;
    }

    let updated: any;
    try {
      // 3. DB 트랜잭션으로 리비전 생성, 태그 교체, 문서 갱신을 단일 트랜잭션으로 원자적 수행
      updated = await this.prisma.$transaction(async (tx) => {
        if (isModified) {
          await tx.documentRevision.create({
            data: {
              documentId: doc.id,
              version: doc.currentVersion,
              title: doc.title,
              objectKey: revisionKey,
            },
          });
        }

        if (dto.tags !== undefined) {
          const tagIds = await this.tagService.resolveTags(
            ownerId,
            dto.tags,
            tx,
          );
          await tx.documentTag.deleteMany({
            where: { documentId: doc.id },
          });
          await tx.documentTag.createMany({
            data: tagIds.map((tagId) => ({
              documentId: doc.id,
              tagId,
            })),
          });
        }

        // 낙관적 잠금 updateMany: 읽기 시점의 currentVersion과 일치할 때만 갱신
        const updateResult = await tx.document.updateMany({
          where: {
            id: doc.id,
            ownerId,
            currentVersion: doc.currentVersion,
          },
          data: {
            title: newTitle,
            folderId: newFolderId,
            currentVersion: nextVersion,
          },
        });

        if (updateResult.count === 0) {
          throw new DocumentVersionConflictException(
            doc.id,
            expectedVersion ?? doc.currentVersion,
          );
        }

        return tx.document.findUniqueOrThrow({
          where: { id: doc.id },
          include: {
            folder: { select: { name: true } },
          },
        });
      });
    } catch (err) {
      // DB 실패 시 MinIO 상태 원복 보상 롤백
      if (isModified) {
        await this.minioService
          .putObject(this.minioService.docsBucket, doc.objectKey, oldRaw)
          .catch(() => {});
        await this.minioService
          .deleteObject(this.minioService.docsBucket, revisionKey)
          .catch(() => {});
      }
      throw err;
    }

    // OpenSearch 색인 갱신
    await this.openSearchService.indexDocument({
      id: updated.id,
      title: updated.title,
      body: newContent,
      tags: activeTagNames,
      folderId: updated.folderId,
      ownerId,
      updatedAt: updated.updatedAt.toISOString(),
    });

    // RabbitMQ 비동기 벡터 인덱싱 이벤트 발행
    await this.rabbitmqService.publish(this.rabbitmqService.indexingQueue, {
      type: 'INDEX',
      documentId: updated.id,
      ownerId,
      version: updated.currentVersion,
      objectKey: updated.objectKey,
      title: updated.title,
      folderId: updated.folderId,
      tags: activeTagNames,
      timestamp: new Date().toISOString(),
    });

    return new DocumentDetailDto({
      id: updated.id,
      title: updated.title,
      folderId: updated.folderId,
      folderName: updated.folder?.name || null,
      tags: activeTagNames,
      currentVersion: updated.currentVersion,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      content: newContent,
      frontmatter: newFrontmatter,
    });
  }

  /**
   * 문서 삭제 (DB를 먼저 삭제하여 고아 레코드/본문 유실 방어)
   */
  async deleteDocument(ownerId: string, documentId: string): Promise<void> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      include: { revisions: true },
    });

    if (!doc) {
      throw new DocumentNotFoundException(documentId);
    }

    // 1. DB 먼저 삭제 (실패 시 MinIO 객체는 안전하게 보존됨)
    await this.prisma.document.delete({
      where: { id: doc.id },
    });

    // 2. DB 삭제 성공 후 MinIO 최신 및 리비전 오브젝트 정리
    await this.minioService
      .deleteObject(this.minioService.docsBucket, doc.objectKey)
      .catch(() => {});

    for (const rev of doc.revisions) {
      await this.minioService
        .deleteObject(this.minioService.docsBucket, rev.objectKey)
        .catch(() => {});
    }

    // 3. OpenSearch 색인 삭제
    await this.openSearchService.deleteDocument(doc.id).catch(() => {});

    // 4. RabbitMQ 비동기 벡터 색인 삭제 이벤트 발행
    await this.rabbitmqService.publish(this.rabbitmqService.indexingQueue, {
      type: 'DELETE',
      documentId: doc.id,
      ownerId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * .md 파일 업로드 임포트
   */
  async importMarkdown(
    ownerId: string,
    file?: Express.Multer.File,
    folderId?: string | null,
  ): Promise<DocumentDetailDto> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new DocumentNotFoundException('임포트할 .md 파일이 제공되지 않았습니다.');
    }

    const rawContent = file.buffer.toString('utf-8');
    const parsed = safeMatter(rawContent);

    // 제목 결정 (Frontmatter -> 첫 번째 헤딩 -> 파일명 순)
    let title = typeof parsed.data.title === 'string' ? parsed.data.title.trim() : '';

    if (!title) {
      const headingMatch = parsed.content.match(/^#\s+(.+)$/m);
      if (headingMatch && headingMatch[1]) {
        title = headingMatch[1].trim();
      }
    }

    if (!title) {
      title = file.originalname.replace(/\.md$/i, '').trim() || 'Untitled Document';
    }

    // 태그 결정
    let tags: string[] = [];
    if (Array.isArray(parsed.data.tags)) {
      tags = parsed.data.tags.map((t) => String(t).trim()).filter(Boolean);
    } else if (typeof parsed.data.tags === 'string') {
      tags = parsed.data.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }

    return this.createDocument(ownerId, {
      title,
      content: parsed.content,
      folderId,
      tags,
      frontmatter: parsed.data,
    });
  }

  /**
   * .md 파일 다운로드를 위한 원문 및 메타데이터 반환
   */
  async exportMarkdown(
    ownerId: string,
    documentId: string,
  ): Promise<{ filename: string; content: string }> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
    });

    if (!doc) {
      throw new DocumentNotFoundException(documentId);
    }

    const raw = await this.minioService.getObjectAsString(
      this.minioService.docsBucket,
      doc.objectKey,
    );

    const safeFilename = doc.title.replace(/[/\\?%*:|"<>]/g, '_') + '.md';

    return {
      filename: safeFilename,
      content: raw,
    };
  }

  /**
   * PDF 내보내기용 PDF 버퍼 생성
   */
  async exportPdf(
    ownerId: string,
    documentId: string,
  ): Promise<{ filename: string; buffer: Uint8Array }> {
    const detail = await this.getDocumentDetail(ownerId, documentId);

    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();
    const margin = 50;
    let y = height - margin;

    // 제목 출력 (Latin-1 지원 글자 또는 기본 변환)
    const sanitize = (text: string) =>
      Array.from(text)
        .map((char) => (char.charCodeAt(0) <= 127 ? char : '?'))
        .join('');

    page.drawText(sanitize(detail.title), {
      x: margin,
      y,
      size: 20,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 30;

    // 메타데이터 줄
    const metaText = `Version: ${detail.currentVersion} | Updated: ${detail.updatedAt.slice(0, 10)}`;
    page.drawText(metaText, {
      x: margin,
      y,
      size: 10,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    y -= 25;

    // 구분선
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 25;

    // 본문 내용 간단 래핑 출력
    const lines = detail.content.split('\n');
    for (const rawLine of lines) {
      if (y < margin + 20) {
        page = pdfDoc.addPage([595.28, 841.89]);
        y = height - margin;
      }

      const line = sanitize(rawLine);
      if (line.startsWith('# ')) {
        page.drawText(line.replace('# ', ''), {
          x: margin,
          y,
          size: 16,
          font: boldFont,
          color: rgb(0.2, 0.2, 0.2),
        });
        y -= 24;
      } else if (line.startsWith('## ')) {
        page.drawText(line.replace('## ', ''), {
          x: margin,
          y,
          size: 14,
          font: boldFont,
          color: rgb(0.3, 0.3, 0.3),
        });
        y -= 20;
      } else {
        page.drawText(line.slice(0, 90), {
          x: margin,
          y,
          size: 10,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });
        y -= 14;
      }
    }

    const pdfBytes = await pdfDoc.save();
    const safeFilename = detail.title.replace(/[/\\?%*:|"<>]/g, '_') + '.pdf';

    return {
      filename: safeFilename,
      buffer: pdfBytes,
    };
  }
}
