import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Injectable, Logger } from '@nestjs/common';
import { safeMatter } from '@app/common/markdown/safe-matter.js';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { OpenSearchService } from '@app/storage/opensearch/opensearch.service.js';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { MarkdownWriterService } from '@app/markdown-core';
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
    private readonly markdownWriterService: MarkdownWriterService,
  ) {}

  /**
   * 신규 문서 생성 (원자적 다단계 쓰기 보장 - @app/markdown-core 위임)
   */
  async createDocument(
    ownerId: string,
    dto: CreateDocumentDto,
  ): Promise<DocumentDetailDto> {
    const content = dto.content || '';
    const frontmatter = dto.frontmatter || {};

    // DTO의 tags와 본문 content의 Frontmatter tags를 안전하게 병합
    const contentFm = safeMatter(content);
    let extractedFmTags: string[] = [];
    if (Array.isArray(contentFm.data?.tags)) {
      extractedFmTags = contentFm.data.tags.map((t) => String(t).trim()).filter(Boolean);
    } else if (typeof contentFm.data?.tags === 'string') {
      extractedFmTags = contentFm.data.tags.split(',').map((t) => t.trim()).filter(Boolean);
    }

    const effectiveTags = Array.from(
      new Set([...(dto.tags || []), ...extractedFmTags]),
    );

    const created = await this.markdownWriterService.createDocument(ownerId, {
      title: dto.title,
      content,
      folderId: dto.folderId,
      tags: effectiveTags,
      frontmatter,
    });

    return new DocumentDetailDto({
      id: created.id,
      title: created.title,
      folderId: created.folderId,
      folderName: created.folderName || null,
      tags: created.tags,
      currentVersion: created.currentVersion,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
      content,
      frontmatter,
    });
  }

  /**
   * 태그 관계가 비어있는 문서들을 찾아 Frontmatter 태그를 DB DocumentTag로 자동 복구
   */
  async syncLegacyDocumentTags(ownerId: string): Promise<void> {
    try {
      const docsWithoutTags = await this.prisma.document.findMany({
        where: {
          ownerId,
          tags: { none: {} },
        },
        select: { id: true, objectKey: true },
      });

      for (const d of docsWithoutTags) {
        try {
          const raw = await this.minioService.getObjectAsString(
            this.minioService.docsBucket,
            d.objectKey,
          );
          const parsed = safeMatter(raw);
          if (parsed.data?.tags) {
            let fmTags: string[] = [];
            if (Array.isArray(parsed.data.tags)) {
              fmTags = parsed.data.tags.map((t: any) => String(t).trim()).filter(Boolean);
            } else if (typeof parsed.data.tags === 'string') {
              fmTags = parsed.data.tags.split(',').map((t: any) => t.trim()).filter(Boolean);
            }
            if (fmTags.length > 0) {
              const tagIds = await this.tagService.resolveTags(ownerId, fmTags);
              await this.prisma.documentTag.createMany({
                data: tagIds.map((tagId) => ({ documentId: d.id, tagId })),
                skipDuplicates: true,
              });
            }
          }
        } catch {
          // 개별 문서 조회 실패 시 건너뜀
        }
      }
    } catch (err) {
      this.logger.warn(`syncLegacyDocumentTags 실패: ${err}`);
    }
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
      if (
        query.tag === '__untagged__' ||
        query.tag.toLowerCase() === 'untagged' ||
        query.tag === '미등록'
      ) {
        where.tags = { none: {} };
      } else {
        where.tags = {
          some: {
            tag: {
              name: query.tag.toLowerCase(),
              ownerId,
            },
          },
        };
      }
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

    let activeTags = doc.tags.map((t: any) => t.tag.name);
    if (activeTags.length === 0 && parsed.data?.tags) {
      let fmTags: string[] = [];
      if (Array.isArray(parsed.data.tags)) {
        fmTags = parsed.data.tags.map((t: any) => String(t).trim()).filter(Boolean);
      } else if (typeof parsed.data.tags === 'string') {
        fmTags = parsed.data.tags.split(',').map((t: any) => t.trim()).filter(Boolean);
      }
      if (fmTags.length > 0) {
        try {
          const tagIds = await this.tagService.resolveTags(ownerId, fmTags);
          await this.prisma.documentTag.createMany({
            data: tagIds.map((tagId) => ({ documentId: doc.id, tagId })),
            skipDuplicates: true,
          });
          activeTags = Array.from(new Set(fmTags.map((t) => t.toLowerCase())));
        } catch (syncErr) {
          this.logger.warn(`문서 상세 태그 자동 동기화 실패: ${syncErr}`);
        }
      }
    }

    return new DocumentDetailDto({
      id: doc.id,
      title: doc.title,
      folderId: doc.folderId,
      folderName: doc.folder?.name || null,
      tags: activeTags,
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

    // 본문 Frontmatter tags 보강: 본문에 Frontmatter tags가 명시되어 있다면 자동 병합
    if (newContent) {
      const contentFm = safeMatter(newContent);
      let extractedFmTags: string[] = [];
      if (Array.isArray(contentFm.data?.tags)) {
        extractedFmTags = contentFm.data.tags.map((t) => String(t).trim()).filter(Boolean);
      } else if (typeof contentFm.data?.tags === 'string') {
        extractedFmTags = contentFm.data.tags.split(',').map((t) => t.trim()).filter(Boolean);
      }
      if (extractedFmTags.length > 0) {
        activeTagNames = Array.from(new Set([...activeTagNames, ...extractedFmTags]));
      }
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

        if (dto.tags !== undefined || isModified) {
          const tagIds = await this.tagService.resolveTags(
            ownerId,
            activeTagNames,
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
   * - 사전 렌더링된 Mermaid 다이어그램 및 KaTeX 수식 그래픽 이미지(PNG) 완벽 임베드
   */
  async exportPdf(
    ownerId: string,
    documentId: string,
    options?: {
      renderedAssets?: Array<{
        type: 'mermaid' | 'math' | string;
        code: string;
        imageBase64: string;
        width?: number;
        height?: number;
      }>;
    },
  ): Promise<{ filename: string; buffer: Uint8Array }> {
    this.logger.log(`exportPdf 호출: documentId=${documentId}, renderedAssets 개수=${options?.renderedAssets?.length ?? 0}`);
    try {
      fs.writeFileSync(
        '/tmp/last-export-debug.json',
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            ownerId,
            documentId,
            renderedAssetsSummary: options?.renderedAssets?.map((a) => ({
              type: a.type,
              code: a.code,
              imageBase64Length: a.imageBase64?.length ?? 0,
              imageBase64Prefix: a.imageBase64?.slice(0, 50),
              width: a.width,
              height: a.height,
            })),
          },
          null,
          2,
        ),
      );
    } catch (e) {
      this.logger.warn(`debug payload 기록 실패: ${e}`);
    }

    const detail = await this.getDocumentDetail(ownerId, documentId);

    const pdfDoc = await PDFDocument.create();

    let font: any;
    let boldFont: any;
    let hasCustomFont = false;

    // 환경 변수 기반 한국어/유니코드 TTF 폰트 파일 탐색 및 시스템 기본 한글 폰트 자동 탐색
    const candidateFontPaths = [
      process.env.PDF_FONT_PATH,
      process.env.CUSTOM_FONT_PATH,
      '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
      '/Library/Fonts/AppleGothic.ttf',
      '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    ].filter(Boolean) as string[];

    const fontPath = candidateFontPaths.find((p) => fs.existsSync(p));
    if (fontPath && fs.existsSync(fontPath)) {
      try {
        pdfDoc.registerFontkit(fontkit as any);
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

    // 4. 자산 매핑 준비 (코드 정규화 및 순서 큐)
    const normalizeCode = (c: string) => c.replace(/\r\n/g, '\n').trim();
    const mermaidAssets = (options?.renderedAssets || []).filter(
      (a) => a.type === 'mermaid',
    );
    const mathAssets = (options?.renderedAssets || []).filter(
      (a) => a.type === 'math',
    );
    let mermaidAssetIndex = 0;
    let mathAssetIndex = 0;
    this.logger.log(
      `PDF 생성 요청: mermaid 자산 = ${mermaidAssets.length}개, math 자산 = ${mathAssets.length}개`,
    );

    // 5. 본문 내용 블록 파싱 및 렌더링
    const lines = detail.content.split(/\r?\n/);
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // A. Mermaid 블록 감지
      if (line.trim().startsWith('```mermaid')) {
        const blockLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          blockLines.push(lines[i]);
          i++;
        }
        i++; // 닫는 ``` 건너뛰기

        const rawCode = blockLines.join('\n');
        const normCode = normalizeCode(rawCode);

        // 자산 매칭 (1. 유효한 이미지를 가진 코드 매칭 우선, 2. 없으면 유효 이미지를 가진 자산 순서 큐 매칭)
        let matchedAsset = mermaidAssets.find(
          (a) => normalizeCode(a.code) === normCode && Boolean(a.imageBase64),
        );
        if (!matchedAsset) {
          while (mermaidAssetIndex < mermaidAssets.length) {
            const candidate = mermaidAssets[mermaidAssetIndex++];
            if (candidate?.imageBase64) {
              matchedAsset = candidate;
              break;
            }
          }
        }

        if (matchedAsset?.imageBase64) {
          try {
            const cleanBase64 = matchedAsset.imageBase64.replace(
              /^data:image\/\w+;base64,/,
              '',
            );
            const imageBytes = Buffer.from(cleanBase64, 'base64');
            const embeddedPng = await pdfDoc.embedPng(imageBytes);

            const origWidth = matchedAsset.width || embeddedPng.width || 500;
            const origHeight = matchedAsset.height || embeddedPng.height || 250;

            const targetWidth = Math.min(maxContentWidth, origWidth);
            const targetHeight = (origHeight / origWidth) * targetWidth;

            // 페이지 오버플로 검사
            if (y < margin + targetHeight + 20) {
              page = pdfDoc.addPage([595.28, 841.89]);
              y = height - margin;
            }

            const drawX = margin + (maxContentWidth - targetWidth) / 2;
            page.drawImage(embeddedPng, {
              x: drawX,
              y: y - targetHeight,
              width: targetWidth,
              height: targetHeight,
            });

            y -= targetHeight + 18;
            continue;
          } catch (err) {
            this.logger.warn(`Mermaid 다이어그램 이미지 임베드 실패: ${err}`);
          }
        }

        // 이미지 매칭 실패 또는 로드 실패 시 깔끔한 텍스트 박스로 안전 폴백
        printLine(`[Mermaid Diagram]`, 11, boldFont, rgb(0.2, 0.4, 0.7), 16);
        for (const bl of blockLines) {
          printLine(`  ${bl}`, 9, font, rgb(0.3, 0.3, 0.3), 13);
        }
        y -= 6;
        continue;
      }

      // B. 블록 수식 ($$ ... $$) 감지
      if (line.trim().startsWith('$$')) {
        const mathLines: string[] = [];
        if (line.trim() === '$$') {
          i++;
          while (i < lines.length && !lines[i].trim().endsWith('$$')) {
            mathLines.push(lines[i]);
            i++;
          }
          if (i < lines.length) {
            const lastL = lines[i].replace(/\$\$$/, '');
            if (lastL.trim()) mathLines.push(lastL);
            i++;
          }
        } else {
          // 한 줄에 다 있는 경우: $$formula$$
          const inner = line.trim().replace(/^\$\$/, '').replace(/\$\$$/, '');
          mathLines.push(inner);
          i++;
        }

        const rawMath = mathLines.join('\n');
        const normMath = normalizeCode(rawMath);

        let matchedMath = mathAssets.find(
          (a) => normalizeCode(a.code) === normMath && Boolean(a.imageBase64),
        );
        if (!matchedMath) {
          while (mathAssetIndex < mathAssets.length) {
            const candidate = mathAssets[mathAssetIndex++];
            if (candidate?.imageBase64) {
              matchedMath = candidate;
              break;
            }
          }
        }

        if (matchedMath?.imageBase64) {
          try {
            const cleanBase64 = matchedMath.imageBase64.replace(
              /^data:image\/\w+;base64,/,
              '',
            );
            const imageBytes = Buffer.from(cleanBase64, 'base64');
            const embeddedPng = await pdfDoc.embedPng(imageBytes);

            const origWidth = matchedMath.width || embeddedPng.width || 350;
            const origHeight = matchedMath.height || embeddedPng.height || 60;

            const targetWidth = Math.min(maxContentWidth * 0.8, origWidth);
            const targetHeight = (origHeight / origWidth) * targetWidth;

            if (y < margin + targetHeight + 15) {
              page = pdfDoc.addPage([595.28, 841.89]);
              y = height - margin;
            }

            const drawX = margin + (maxContentWidth - targetWidth) / 2;
            page.drawImage(embeddedPng, {
              x: drawX,
              y: y - targetHeight,
              width: targetWidth,
              height: targetHeight,
            });

            y -= targetHeight + 14;
            continue;
          } catch (err) {
            this.logger.warn(`KaTeX 수식 이미지 임베드 실패: ${err}`);
          }
        }

        // 수식 이미지 미제공 시: 깔끔한 수식 박스 컨테이너 조판
        const boxHeight = 34;
        if (y < margin + boxHeight + 10) {
          page = pdfDoc.addPage([595.28, 841.89]);
          y = height - margin;
        }

        page.drawRectangle({
          x: margin,
          y: y - boxHeight,
          width: maxContentWidth,
          height: boxHeight,
          color: rgb(0.96, 0.96, 0.98),
          borderColor: rgb(0.85, 0.85, 0.88),
          borderWidth: 1,
        });

        const readableMath = rawMath
          .replace(/\\sum/g, '∑')
          .replace(/\\prod/g, '∏')
          .replace(/\\int/g, '∫')
          .replace(/\\approx/g, '≈')
          .replace(/\\neq/g, '≠')
          .replace(/\\leq/g, '≤')
          .replace(/\\geq/g, '≥')
          .replace(/\\mathcal\{([A-Za-z])\}/g, '$1')
          .replace(/\\([a-zA-Z]+)/g, '$1')
          .replace(/[{}]/g, '');

        page.drawText(`f(x)  ${readableMath}`, {
          x: margin + 14,
          y: y - boxHeight + 11,
          size: 11,
          font: boldFont,
          color: rgb(0.15, 0.15, 0.25),
        });

        y -= boxHeight + 14;
        continue;
      }

      // C. 일반 마크다운 라인 처리
      if (line.startsWith('# ')) {
        y -= 6;
        printLine(line.replace('# ', ''), 16, boldFont, rgb(0.1, 0.1, 0.1), 22);
        y -= 4;
      } else if (line.startsWith('## ')) {
        y -= 4;
        printLine(line.replace('## ', ''), 14, boldFont, rgb(0.2, 0.2, 0.2), 19);
        y -= 2;
      } else if (line.startsWith('### ')) {
        printLine(line.replace('### ', ''), 12, boldFont, rgb(0.25, 0.25, 0.25), 16);
      } else if (line.trim().startsWith('- [x] ') || line.trim().startsWith('- [ ] ')) {
        const isChecked = line.trim().startsWith('- [x] ');
        const itemText = line.trim().slice(6);
        const checkSymbol = isChecked ? '[V] ' : '[  ] ';
        printLine(`${checkSymbol}${itemText}`, 10, font, rgb(0.2, 0.2, 0.2), 15);
      } else if (line.trim() === '') {
        y -= 8;
      } else {
        printLine(line, 10, font, rgb(0.2, 0.2, 0.2), 14);
      }

      i++;
    }

    const pdfBytes = await pdfDoc.save();
    const safeFilename = detail.title.replace(/[/\\?%*:|"<>]/g, '_') + '.pdf';

    return {
      filename: safeFilename,
      buffer: pdfBytes,
    };
  }
}
