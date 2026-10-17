import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { MarkdownWriterService } from '@app/markdown-core';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { QdrantService } from '@app/storage/qdrant/qdrant.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import type { LlmToolDefinition } from '../providers/llm.provider.interface.js';

const searchMyDocumentsArgsSchema = z.object({
  query: z
    .string()
    .min(1, '검색어는 필수입니다.')
    .max(1000, '검색어는 최대 1,000자 이하여야 합니다.'),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

const readDocumentArgsSchema = z.object({
  documentId: z.string().min(1, '문서 ID는 필수입니다.').max(100),
});

const saveToMarkdownArgsSchema = z.object({
  title: z.string().min(1).max(200).default('Untitled AI Note'),
  content: z
    .string()
    .max(50_000, '문서 본문은 최대 50,000자 이하여야 합니다.')
    .default(''),
  folderId: z
    .string()
    .max(100, '폴더 ID는 최대 100자 이하여야 합니다.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

@Injectable()
export class AiToolsService {
  private readonly logger = new Logger(AiToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
    private readonly qdrantService: QdrantService,
    private readonly providerFactory: ProviderFactory,
    private readonly markdownWriterService: MarkdownWriterService,
  ) {}

  /**
   * AI가 사용할 수 있는 허용된 도구 명세 (Function Declarations)
   */
  getToolDefinitions(): LlmToolDefinition[] {
    return [
      {
        name: 'search_my_documents',
        description:
          '사용자가 작성한 개인 마크다운 문서들 중에서 질의어와 가장 관련성이 높은 본문 청크들을 시맨틱 검색합니다.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '검색할 키워드 또는 자연어 질의',
            },
            limit: {
              type: 'number',
              description: '조회할 최대 청크 개수 (최소 1개, 최대 10개, 기본 5개)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'read_document',
        description:
          '특정 마크다운 문서의 전체 원문(본문 및 Frontmatter)을 조회하여 정밀하게 읽습니다.',
        parameters: {
          type: 'object',
          properties: {
            documentId: {
              type: 'string',
              description: '조회할 문서의 고유 ID',
            },
          },
          required: ['documentId'],
        },
      },
      {
        name: 'save_to_markdown',
        description:
          'AI가 생성하거나 정리한 지식/답변을 사용자의 마크다운 공간에 신규 문서로 저장합니다.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: '새로 저장할 문서 제목',
            },
            content: {
              type: 'string',
              description: '마크다운 형식의 본문 내용',
            },
            folderId: {
              type: 'string',
              description: '보관할 폴더 ID (선택 사항)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: '부여할 태그 목록 (선택 사항)',
            },
          },
          required: ['title', 'content'],
        },
      },
    ];
  }

  /**
   * Tool 함수 동적 실행기 (소유자 격리 보장 및 인자 스키마 검증)
   */
  async executeTool(
    name: string,
    args: Record<string, unknown>,
    ownerId: string,
  ): Promise<string> {
    this.logger.log(`[ToolExecution] 도구 호출: ${name} (owner=${ownerId})`);

    switch (name) {
      case 'search_my_documents': {
        const parsed = searchMyDocumentsArgsSchema.safeParse(args);
        if (!parsed.success) {
          const errMsg = parsed.error.issues.map((i) => i.message).join(', ');
          this.logger.warn(`[ToolExecution] search_my_documents 인자 검증 실패: ${errMsg}`);
          return `도구 인자 오류: ${errMsg}`;
        }
        return this.searchMyDocuments(ownerId, parsed.data.query, parsed.data.limit);
      }
      case 'read_document': {
        const parsed = readDocumentArgsSchema.safeParse(args);
        if (!parsed.success) {
          const errMsg = parsed.error.issues.map((i) => i.message).join(', ');
          this.logger.warn(`[ToolExecution] read_document 인자 검증 실패: ${errMsg}`);
          return `도구 인자 오류: ${errMsg}`;
        }
        return this.readDocument(ownerId, parsed.data.documentId);
      }
      case 'save_to_markdown': {
        const parsed = saveToMarkdownArgsSchema.safeParse(args);
        if (!parsed.success) {
          const errMsg = parsed.error.issues.map((i) => i.message).join(', ');
          this.logger.warn(`[ToolExecution] save_to_markdown 인자 검증 실패: ${errMsg}`);
          return `도구 인자 오류: ${errMsg}`;
        }
        return this.saveToMarkdown(
          ownerId,
          parsed.data.title,
          parsed.data.content,
          parsed.data.folderId,
          parsed.data.tags,
        );
      }
      default:
        throw new NotFoundException(`지원하지 않는 도구 이름입니다: ${name}`);
    }
  }

  private async searchMyDocuments(
    ownerId: string,
    query: string,
    limit: number,
  ): Promise<string> {
    const embeddingProvider = this.providerFactory.getEmbeddingProvider();
    const queryVector = await embeddingProvider.embedText(query);

    const results = await this.qdrantService.searchPoints(
      ownerId,
      queryVector,
      limit,
      {
        embeddingModel:
          embeddingProvider.embeddingModel || embeddingProvider.name,
      },
    );

    if (results.length === 0) {
      return '일치하는 관련 개인 문서를 찾지 못했습니다.';
    }

    const formatted = results
      .map(
        (r: any, i: number) =>
          `[검색 결과 ${i + 1}] (문서 ID: ${escapeXmlAttr(String(r.payload.documentId))}, 제목: "${escapeXmlAttr(String(r.payload.title))}", 유사도: ${r.score.toFixed(3)})\n소속 헤딩: ${r.payload.heading}\n본문 내용:\n${r.payload.content}`,
      )
      .join('\n\n---\n\n');

    return `<untrusted_document_context>\n${formatted}\n</untrusted_document_context>`;
  }

  private async readDocument(
    ownerId: string,
    documentId: string,
  ): Promise<string> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
    });

    if (!doc) {
      throw new NotFoundException(`문서를 찾을 수 없습니다: ${documentId}`);
    }

    const raw = await this.minioService.getObjectAsString(
      this.minioService.docsBucket,
      doc.objectKey,
    );

    const MAX_DOCUMENT_LENGTH = 10_000;
    const truncated =
      raw.length > MAX_DOCUMENT_LENGTH
        ? raw.slice(0, MAX_DOCUMENT_LENGTH) + '\n\n...[문서 본문이 길어 최대 10,000자까지만 표시되었습니다]...'
        : raw;

    const safeTitle = escapeXmlAttr(doc.title);
    const safeDocId = escapeXmlAttr(documentId);

    return `<untrusted_document_context docId="${safeDocId}" title="${safeTitle}">\n${truncated}\n</untrusted_document_context>`;
  }

  private async saveToMarkdown(
    ownerId: string,
    title: string,
    content: string,
    folderId?: string,
    tags?: string[],
  ): Promise<string> {
    const defaultTags = tags && tags.length > 0 ? tags : ['ai-generated'];

    // 도메인 핵심 서비스(MarkdownWriterService)를 통한 안전한 단일 소스 생성
    const created = await this.markdownWriterService.createDocument(ownerId, {
      title,
      content,
      folderId,
      tags: defaultTags,
      frontmatter: {
        title,
        tags: defaultTags,
        createdAt: new Date().toISOString(),
      },
    });

    return JSON.stringify({
      success: true,
      documentId: created.id,
      title: created.title,
      folderId: created.folderId,
      message: '새 마크다운 문서로 성공적으로 저장되었습니다.',
    });
  }
}
