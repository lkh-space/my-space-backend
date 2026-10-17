import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
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
  InvalidMarkdownFileException,
} from '../exceptions/markdown.exception.js';


@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
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
   * 문서 목록 조회 (오프셋 및 커서 페이징, 폴더, 태그 필터링)
   */
  async getDocuments(
    ownerId: string,
    query: DocumentQueryDto,
  ): Promise<{
    total: number;
    page: number;
    limit: number;
    items: DocumentListItemDto[];
    nextCursor: string | null;
  }> {
    const limit = query.limit ?? 20;

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

    const findArgs: any = {
      where,
      take: limit,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        folder: { select: { name: true } },
        tags: {
          select: {
            tag: { select: { name: true } },
          },
        },
      },
    };

    let page = 1;

    if (query.cursor) {
      // 커서 기반 페이징: 기준 ID의 다음 항목부터 조회
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    } else {
      // 오프셋 기반 페이징
      page = query.page ?? 1;
      findArgs.skip = (page - 1) * limit;
    }

    const [total, documents] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany(findArgs),
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

    const nextCursor = items.length === limit ? items[items.length - 1].id : null;

    return { total, page, limit, items, nextCursor };
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

    // 2. DB 삭제 성공 후 MinIO 최신 및 모든 과거 리비전 오브젝트 일괄 배치 삭제 (고아 객체 방지)
    const keysToDelete = [
      doc.objectKey,
      ...doc.revisions.map((rev) => rev.objectKey),
    ].filter(Boolean);

    await this.minioService
      .deleteObjects(this.minioService.docsBucket, keysToDelete)
      .catch(() => {});

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
      throw new InvalidMarkdownFileException('임포트할 .md 파일이 제공되지 않았습니다.');
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
   * - UTF-8 / 한글 폰트 지원 (@pdf-lib/fontkit 및 PDF_FONT_PATH / CUSTOM_FONT_PATH)
   * - Dynamic line wrapping (고정 길이 절단 제거)
   * - 자동 페이지네이션 (페이지 오버플로 시 새 페이지 생성)
   */
  async exportPdf(
    ownerId: string,
    documentId: string,
  ): Promise<{ filename: string; buffer: Uint8Array }> {
    const detail = await this.getDocumentDetail(ownerId, documentId);

    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.create();

    let font: any;
    let boldFont: any;
    let hasCustomFont = false;

    // 환경 변수 기반 한국어/유니코드 TTF 폰트 파일 탐색 및 fontkit 등록
    const fontPath = process.env.PDF_FONT_PATH || process.env.CUSTOM_FONT_PATH;
    if (fontPath && fs.existsSync(fontPath)) {
      try {
        const fontkitModule = await import('@pdf-lib/fontkit');
        const fontkit = (fontkitModule.default || fontkitModule) as any;
        pdfDoc.registerFontkit(fontkit);
        const fontBytes = fs.readFileSync(fontPath);
        font = await pdfDoc.embedFont(fontBytes);
        boldFont = font;
        hasCustomFont = true;
      } catch (e) {
        this.logger.warn(`PDF 커스텀 폰트 로드 실패, 표준 폰트로 대체: ${e}`);
      }
    }

    if (!hasCustomFont) {
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }

    let page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();
    const margin = 50;
    const maxContentWidth = width - margin * 2;
    let y = height - margin;

    // 폰트가 유니코드를 지원하지 않을 경우 WinAnsi 범위 외 문자 안전 처리
    const sanitize = (text: string) => {
      if (hasCustomFont) return text;
      return Array.from(text)
        .map((char) => (char.charCodeAt(0) <= 255 ? char : '?'))
        .join('');
    };

    // 폭에 따른 동적 줄바꿈 (Dynamic Line Wrapping)
    const wrapText = (text: string, targetFont: any, fontSize: number): string[] => {
      const sanitized = sanitize(text);
      if (!sanitized) return [''];

      const words = sanitized.split(' ');
      const resultLines: string[] = [];
      let currentLine = '';

      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        let candidateWidth: number;
        try {
          candidateWidth = targetFont.widthOfTextAtSize(candidate, fontSize);
        } catch {
          candidateWidth = candidate.length * fontSize * 0.5;
        }

        if (candidateWidth <= maxContentWidth) {
          currentLine = candidate;
        } else {
          if (currentLine) {
            resultLines.push(currentLine);
          }
          // 단일 단어가 maxContentWidth를 초과하는 경우 문자 단위 분할
          let singleWord = word;
          while (singleWord.length > 0) {
            let charIndex = 0;
            while (charIndex < singleWord.length) {
              const sub = singleWord.slice(0, charIndex + 1);
              let subWidth = 0;
              try {
                subWidth = targetFont.widthOfTextAtSize(sub, fontSize);
              } catch {
                subWidth = sub.length * fontSize * 0.5;
              }
              if (subWidth > maxContentWidth && charIndex > 0) break;
              charIndex++;
            }
            resultLines.push(singleWord.slice(0, charIndex));
            singleWord = singleWord.slice(charIndex);
          }
          currentLine = '';
        }
      }

      if (currentLine) {
        resultLines.push(currentLine);
      }

      return resultLines.length > 0 ? resultLines : [''];
    };

    const printLine = (
      text: string,
      fontSize: number,
      targetFont: any,
      color: any,
      lineSpacing: number,
    ) => {
      const wrapped = wrapText(text, targetFont, fontSize);
      for (const wl of wrapped) {
        if (y < margin + fontSize) {
          page = pdfDoc.addPage([595.28, 841.89]);
          y = height - margin;
        }
        page.drawText(wl, {
          x: margin,
          y,
          size: fontSize,
          font: targetFont,
          color,
        });
        y -= lineSpacing;
      }
    };

    // 1. 제목 출력
    printLine(detail.title, 20, boldFont, rgb(0.1, 0.1, 0.1), 26);
    y -= 10;

    // 2. 메타데이터 줄
    const metaText = `Version: ${detail.currentVersion} | Updated: ${detail.updatedAt.slice(0, 10)}`;
    printLine(metaText, 10, font, rgb(0.5, 0.5, 0.5), 16);
    y -= 8;

    // 3. 구분선
    if (y < margin + 10) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = height - margin;
    }
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 20;

    // 4. 본문 내용 동적 래핑 및 페이지네이션 출력
    const lines = detail.content.split('\n');
    for (const rawLine of lines) {
      if (rawLine.startsWith('# ')) {
        printLine(rawLine.replace('# ', ''), 16, boldFont, rgb(0.2, 0.2, 0.2), 22);
      } else if (rawLine.startsWith('## ')) {
        printLine(rawLine.replace('## ', ''), 14, boldFont, rgb(0.3, 0.3, 0.3), 18);
      } else {
        printLine(rawLine, 10, font, rgb(0.2, 0.2, 0.2), 14);
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
