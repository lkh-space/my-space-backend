import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { QdrantService } from '@app/storage/qdrant/qdrant.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import { MarkdownChunker } from '../utils/markdown-chunker.js';

interface IndexEvent {
  type: 'INDEX';
  documentId: string;
  ownerId: string;
  version: number;
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
    // RabbitMQ 연결 대기 후 Consumer 등록
    setTimeout(() => {
      this.startConsumer();
    }, 2000);
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

      // 1. MinIO에서 최신 원문 다운로드
      const objectKey = `docs/${message.ownerId}/${message.documentId}/current.md`;
      let rawMarkdown = '';
      try {
        rawMarkdown = await this.minioService.getObjectAsString(
          this.minioService.docsBucket,
          objectKey,
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`MinIO 원문 로드 실패 (${objectKey}): ${errorMsg}`);
        return;
      }

      // 2. 마크다운 청킹
      const chunks = MarkdownChunker.chunk(rawMarkdown);
      if (chunks.length === 0) {
        this.logger.log(`[IndexingWorker] 청킹 결과 빈 내용 (docId=${message.documentId})`);
        return;
      }

      // 3. 임베딩 생성 (Gemini 또는 Ollama)
      const embeddingProvider = this.providerFactory.getEmbeddingProvider();
      const points: Array<{
        id: string;
        vector: number[];
        payload: {
          ownerId: string;
          documentId: string;
          version: number;
          chunkIndex: number;
          title: string;
          heading: string;
          content: string;
          tags?: string[];
          folderId?: string | null;
        };
      }> = [];

      for (const chunk of chunks) {
        try {
          const vector = await embeddingProvider.embedText(
            `제목: ${message.title}\n헤딩: ${chunk.heading}\n\n${chunk.content}`,
          );

          points.push({
            id: randomUUID(),
            vector,
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
            },
          });
        } catch (embedErr: unknown) {
          const errorMsg =
            embedErr instanceof Error ? embedErr.message : String(embedErr);
          this.logger.error(
            `청크 임베딩 생성 실패 (chunkIndex=${chunk.chunkIndex}): ${errorMsg}`,
          );
        }
      }

      // 4. Qdrant 기존 벡터 삭제 후 신규 청크 Upsert
      await this.qdrantService.deletePointsByDocument(
        message.ownerId,
        message.documentId,
      );
      await this.qdrantService.upsertPoints(points);

      this.logger.log(
        `[IndexingWorker] Qdrant 벡터 색인 완료 [docId=${message.documentId}, 청크=${points.length}개]`,
      );
    }
  }
}
