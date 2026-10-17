import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { safeMatter } from '@app/common/markdown/safe-matter.js';
import { FolderNotFoundException } from '@app/common';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { OpenSearchService } from '@app/storage/opensearch/opensearch.service.js';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { TagResolverService } from './tag-resolver.service.js';
import type {
  CreateMarkdownDocumentParams,
  CreatedMarkdownDocumentResult,
} from '../interfaces/markdown-document.interface.js';

@Injectable()
export class MarkdownWriterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
    private readonly openSearchService: OpenSearchService,
    private readonly rabbitmqService: RabbitmqService,
    private readonly tagResolverService: TagResolverService,
  ) {}

  /**
   * 신규 마크다운 문서 생성 도메인 유스케이스
   *
   * [보안 및 원자적 무결성 보장]
   * 1. 폴더 소유권 검증 (Cross-tenant Reference 차단)
   * 2. ID 및 ObjectKey 사전 생성 (고아 objectKey 레코드 방지)
   * 3. MinIO 선행 저장 (실패 시 DB 오염 원천 방지)
   * 4. DB 트랜잭션 원자적 생성 및 Tag 정합성 보장 (실패 시 MinIO 보상 롤백 삭제)
   * 5. OpenSearch 전문 검색 색인 동기화
   * 6. RabbitMQ 벡터 인덱싱 이벤트 발행 (objectKey 포함)
   */
  async createDocument(
    ownerId: string,
    params: CreateMarkdownDocumentParams,
  ): Promise<CreatedMarkdownDocumentResult> {
    const folderId = params.folderId || null;

    if (folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: folderId, ownerId },
        select: { id: true },
      });
      if (!folder) {
        throw new FolderNotFoundException(folderId);
      }
    }

    // Frontmatter와 본문 결합
    const frontmatter = params.frontmatter || {};
    const content = params.content || '';
    const rawMarkdown = safeMatter.stringify(content, frontmatter);

    // 식별자 및 오브젝트 키 사전 계산
    const id = randomUUID();
    const objectKey = `docs/${ownerId}/${id}/current.md`;
    const tagNames = params.tags || [];

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
        const tagIds = await this.tagResolverService.resolveTags(
          ownerId,
          tagNames,
          tx,
        );

        return tx.document.create({
          data: {
            id,
            title: params.title,
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

    // 3. OpenSearch 비동기 색인 (키워드 및 전문 검색 보장)
    await this.openSearchService.indexDocument({
      id: created.id,
      title: created.title,
      body: content,
      tags: tagNames,
      folderId: created.folderId,
      ownerId,
      updatedAt: created.updatedAt.toISOString(),
    });

    // 4. RabbitMQ 비동기 벡터 인덱싱 이벤트 발행 (objectKey 명시적 전달)
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

    return {
      id: created.id,
      title: created.title,
      folderId: created.folderId,
      folderName: created.folder?.name ?? null,
      tags: tagNames,
      objectKey,
      currentVersion: 1,
      updatedAt: created.updatedAt,
      createdAt: created.createdAt,
    };
  }
}
