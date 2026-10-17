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
   * [보안 및 무결성 보장]
   * 1. 폴더 소유권 검증 (Cross-tenant Reference 차단)
   * 2. Tag 관계 테이블 정합성 보장 (DocumentTag 연동)
   * 3. S3/MinIO 원문 안전 저장
   * 4. OpenSearch 전문 검색 색인 동기화
   * 5. RabbitMQ 벡터 인덱싱 이벤트 발행 (objectKey 포함하여 워커의 키 추론 제거)
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

    // 태그 ID 확인/생성
    const tagNames = params.tags || [];
    const tagIds = await this.tagResolverService.resolveTags(ownerId, tagNames);

    // 1. DB 레코드 생성
    const created = await this.prisma.document.create({
      data: {
        title: params.title,
        folderId,
        ownerId,
        currentVersion: 1,
        objectKey: '', // 아래에서 생성 후 갱신
        tags: {
          create: tagIds.map((tagId) => ({ tagId })),
        },
      },
      include: {
        folder: { select: { name: true } },
      },
    });

    const objectKey = `docs/${ownerId}/${created.id}/current.md`;

    // 2. MinIO에 최신 본문 저장
    await this.minioService.putObject(
      this.minioService.docsBucket,
      objectKey,
      rawMarkdown,
    );

    // 3. DB objectKey 갱신
    const updated = await this.prisma.document.update({
      where: { id: created.id },
      data: { objectKey },
    });

    // 4. OpenSearch 비동기 색인 (키워드 및 전문 검색 보장)
    await this.openSearchService.indexDocument({
      id: created.id,
      title: created.title,
      body: content,
      tags: tagNames,
      folderId: created.folderId,
      ownerId,
      updatedAt: updated.updatedAt.toISOString(),
    });

    // 5. RabbitMQ 비동기 벡터 인덱싱 이벤트 발행 (objectKey 명시적 전달)
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
      updatedAt: updated.updatedAt,
      createdAt: created.createdAt,
    };
  }
}
