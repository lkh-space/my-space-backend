import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import matter from 'gray-matter';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { QdrantService } from '@app/storage/qdrant/qdrant.service.js';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import type { LlmToolDefinition } from '../providers/llm.provider.interface.js';

@Injectable()
export class AiToolsService {
  private readonly logger = new Logger(AiToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
    private readonly qdrantService: QdrantService,
    private readonly rabbitmqService: RabbitmqService,
    private readonly providerFactory: ProviderFactory,
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
              description: '조회할 최대 청크 개수 (기본 5개)',
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
   * Tool 함수 동적 실행기 (소유자 격리 보장)
   */
  async executeTool(
    name: string,
    args: Record<string, unknown>,
    ownerId: string,
  ): Promise<string> {
    this.logger.log(`[ToolExecution] 도구 호출: ${name} (owner=${ownerId})`);

    switch (name) {
      case 'search_my_documents': {
        const query = String(args.query || '');
        const limit = Number(args.limit) || 5;
        return this.searchMyDocuments(ownerId, query, limit);
      }
      case 'read_document': {
        const documentId = String(args.documentId || '');
        return this.readDocument(ownerId, documentId);
      }
      case 'save_to_markdown': {
        const title = String(args.title || 'Untitled AI Note');
        const content = String(args.content || '');
        const folderId = args.folderId ? String(args.folderId) : undefined;
        const tags = Array.isArray(args.tags)
          ? (args.tags as string[])
          : undefined;
        return this.saveToMarkdown(ownerId, title, content, folderId, tags);
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
    );

    if (results.length === 0) {
      return '일치하는 관련 개인 문서를 찾지 못했습니다.';
    }

    const formatted = results
      .map(
        (r: any, i: number) =>
          `[검색 결과 ${i + 1}] (문서 ID: ${r.payload.documentId}, 제목: "${r.payload.title}", 유사도: ${r.score.toFixed(3)})\n소속 헤딩: ${r.payload.heading}\n본문 내용:\n${r.payload.content}`,
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

    return `<untrusted_document_context docId="${documentId}" title="${doc.title}">\n${raw}\n</untrusted_document_context>`;
  }

  private async saveToMarkdown(
    ownerId: string,
    title: string,
    content: string,
    folderId?: string,
    tags?: string[],
  ): Promise<string> {
    // 1. DB 생성
    const created = await this.prisma.document.create({
      data: {
        title,
        folderId: folderId || null,
        ownerId,
        currentVersion: 1,
        objectKey: '',
      },
    });

    const objectKey = `docs/${ownerId}/${created.id}/current.md`;
    const rawMarkdown = matter.stringify(content, {
      title,
      tags: tags || ['ai-generated'],
      createdAt: new Date().toISOString(),
    });

    // 2. MinIO 저장
    await this.minioService.putObject(
      this.minioService.docsBucket,
      objectKey,
      rawMarkdown,
    );

    // 3. DB objectKey 갱신
    await this.prisma.document.update({
      where: { id: created.id },
      data: { objectKey },
    });

    // 4. RabbitMQ 인덱싱 이벤트 발행
    await this.rabbitmqService.publish(this.rabbitmqService.indexingQueue, {
      type: 'INDEX',
      documentId: created.id,
      ownerId,
      version: 1,
      title,
      folderId: created.folderId,
      tags: tags || ['ai-generated'],
      timestamp: new Date().toISOString(),
    });

    return JSON.stringify({
      success: true,
      documentId: created.id,
      title: created.title,
      message: '새 마크다운 문서로 성공적으로 저장되었습니다.',
    });
  }
}
