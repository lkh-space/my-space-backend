import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { QdrantService } from '@app/storage/qdrant/qdrant.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import { MarkdownChunker } from '../utils/markdown-chunker.js';
import { generateDeterministicChunkId } from '../utils/uuid-v5.js';

interface IndexEvent {
  type: 'INDEX';
  documentId: string;
  ownerId: string;
  version: number;
  objectKey?: string;
  title: string;
  folderId?: string | null;
  tags?: string[];
  timestamp: string;
}

interface DeleteEvent {
  type: 'DELETE';
  documentId: string;
  ownerId: string;
  timestamp: string;
}

type IndexingMessage = IndexEvent | DeleteEvent;

@Injectable()
export class IndexingConsumerWorker implements OnModuleInit {
  private readonly logger = new Logger(IndexingConsumerWorker.name);

  constructor(
    private readonly rabbitmqService: RabbitmqService,
    private readonly qdrantService: QdrantService,
    private readonly minioService: MinioService,
    private readonly providerFactory: ProviderFactory,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.startConsumer();
  }

  private async startConsumer(): Promise<void> {
    try {
      await this.rabbitmqService.consume<IndexingMessage>(
        this.rabbitmqService.indexingQueue,
        async (message: IndexingMessage) => {
          await this.handleMessage(message);
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`인덱싱 Consumer 시작 실패: ${message}`);
    }
  }

  async handleMessage(message: IndexingMessage): Promise<void> {
    if (message.type === 'DELETE') {
      this.logger.log(
        `[IndexingWorker] 문서 벡터 색인 삭제 처리 (docId=${message.documentId}, owner=${message.ownerId})`,
      );
      await this.qdrantService.deletePointsByDocument(
        message.ownerId,
        message.documentId,
      );
      return;
    }

    if (message.type === 'INDEX') {
      this.logger.log(
        `[IndexingWorker] 문서 벡터 색인 생성/갱신 처리 (docId=${message.documentId}, owner=${message.ownerId}, ver=${message.version})`,
      );

      // 1. 오래된 이벤트(Out-of-order 메시지) 덮어쓰기 방어
      const latestIndexedVersion =
        await this.qdrantService.getLatestVersionForDocument(
          message.ownerId,
          message.documentId,
        );
      if (latestIndexedVersion !== null && latestIndexedVersion > message.version) {
        this.logger.warn(
          `[IndexingWorker] 이미 더 최신 버전(v${latestIndexedVersion})이 색인되어 있어 구버전(v${message.version}) 이벤트를 무시합니다. (docId=${message.documentId})`,
        );
        return;
      }

      // 2. MinIO에서 최신 원문 다운로드 (메시지의 objectKey 우선 사용, 부재 시 fallback)
      const objectKey =
        message.objectKey ||
        `docs/${message.ownerId}/${message.documentId}/current.md`;
      let rawMarkdown = '';
      try {
        rawMarkdown = await this.minioService.getObjectAsString(
          this.minioService.docsBucket,
          objectKey,
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`MinIO 원문 로드 실패 (${objectKey}): ${errorMsg}`);
        // 재시도 큐 및 DLQ 처리를 위해 에러를 상위로 전파
        throw new Error(`MinIO 원문 파일 조회 실패 (${objectKey}): ${errorMsg}`);
      }

      // 3. 마크다운 청킹
      const chunks = MarkdownChunker.chunk(rawMarkdown);
      if (chunks.length === 0) {
        this.logger.log(`[IndexingWorker] 청킹 결과 빈 내용 (docId=${message.documentId})`);
        return;
      }

      // 4. 원자적 배치 임베딩 (All-or-Nothing: 부분 인덱스 방지)
      const embeddingProvider = this.providerFactory.getEmbeddingProvider();
      const embeddingTexts = chunks.map(
        (chunk) =>
          `제목: ${message.title}\n헤딩: ${chunk.heading}\n\n${chunk.content}`,
      );

      // 하나라도 실패하면 throw되어 H-3 RabbitMQ Retry/DLQ로 위임
      const vectors = await embeddingProvider.embedBatch(embeddingTexts);

      // 5. 결정적 멱등 포인트 ID 생성 (uuid-v5)
      const points = chunks.map((chunk, index) => ({
        id: generateDeterministicChunkId(message.documentId, chunk.chunkIndex),
        vector: vectors[index],
        payload: {
          ownerId: message.ownerId,
          documentId: message.documentId,
          version: message.version,
          chunkIndex: chunk.chunkIndex,
          title: message.title,
          heading: chunk.heading,
          content: chunk.content,
          tags: message.tags,
          folderId: message.folderId,
          embeddingModel: embeddingProvider.embeddingModel || embeddingProvider.name,
        },
      }));

      // 6. Zero-Downtime Upsert: 업서트를 먼저 수행하여 검색 공백 방지
      await this.qdrantService.upsertPoints(points);

      // 7. 업서트 성공 후, 이전 구버전(ver < currentVersion) 잔여 포인트만 안전하게 정리
      await this.qdrantService.deleteOldVersionsByDocument(
        message.ownerId,
        message.documentId,
        message.version,
      );

      this.logger.log(
        `[IndexingWorker] Qdrant 벡터 색인 완료 (Zero-downtime) [docId=${message.documentId}, 청크=${points.length}개, ver=${message.version}]`,
      );
    }
  }
}

