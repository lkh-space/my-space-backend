import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IndexingConsumerWorker } from './indexing-consumer.worker.js';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { QdrantService } from '@app/storage/qdrant/qdrant.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';

describe('IndexingConsumerWorker (인덱싱 워커 에러 핸들링 및 소비 단위 테스트)', () => {
  let worker: IndexingConsumerWorker;
  let rabbitmqService: RabbitmqService;
  let qdrantService: QdrantService;
  let minioService: MinioService;
  let providerFactory: ProviderFactory;
  let mockEmbeddingProvider: any;

  beforeEach(() => {
    rabbitmqService = {
      indexingQueue: 'markdown-indexing-queue',
      consume: vi.fn().mockResolvedValue(undefined),
    } as unknown as RabbitmqService;

    qdrantService = {
      deletePointsByDocument: vi.fn().mockResolvedValue(undefined),
      upsertPoints: vi.fn().mockResolvedValue(undefined),
    } as unknown as QdrantService;

    minioService = {
      docsBucket: 'my-space-markdown',
      getObjectAsString: vi.fn(),
    } as unknown as MinioService;

    mockEmbeddingProvider = {
      embedText: vi.fn().mockResolvedValue(Array.from({ length: 768 }, () => 0.1)),
    };

    providerFactory = {
      getEmbeddingProvider: vi.fn().mockReturnValue(mockEmbeddingProvider),
    } as unknown as ProviderFactory;

    worker = new IndexingConsumerWorker(
      rabbitmqService,
      qdrantService,
      minioService,
      providerFactory,
    );
  });

  describe('onModuleInit', () => {
    it('지연 타이머 없이 즉시 rabbitmqService.consume을 호출하여 컨슈머를 등록해야 한다', async () => {
      // when
      await worker.onModuleInit();

      // then
      expect(rabbitmqService.consume).toHaveBeenCalledWith(
        'markdown-indexing-queue',
        expect.any(Function),
      );
    });
  });

  describe('handleMessage - INDEX 이벤트', () => {
    it('정상적인 인덱싱 메시지 처리 시 MinIO에서 원문을 로드하여 Qdrant에 저장해야 한다', async () => {
      // given
      const rawMarkdown = '# 테스트 제목\n\n본문 내용입니다.';
      vi.mocked(minioService.getObjectAsString).mockResolvedValueOnce(rawMarkdown);

      const message = {
        type: 'INDEX' as const,
        documentId: 'doc-1',
        ownerId: 'user-admin',
        version: 1,
        title: '테스트 제목',
        tags: ['test'],
        timestamp: new Date().toISOString(),
      };

      // when
      await worker.handleMessage(message);

      // then
      expect(minioService.getObjectAsString).toHaveBeenCalledWith(
        'my-space-markdown',
        'docs/user-admin/doc-1/current.md',
      );
      expect(qdrantService.deletePointsByDocument).toHaveBeenCalledWith('user-admin', 'doc-1');
      expect(qdrantService.upsertPoints).toHaveBeenCalled();
    });

    it('MinIO 원문 로드 실패 시 에러를 삼키지 않고 throw하여 상위 재시도/DLQ 메커니즘에 전달해야 한다 (H-3)', async () => {
      // given
      vi.mocked(minioService.getObjectAsString).mockRejectedValueOnce(
        new Error('S3 Connection timeout'),
      );

      const message = {
        type: 'INDEX' as const,
        documentId: 'doc-fail',
        ownerId: 'user-admin',
        version: 1,
        title: '실패할 문서',
        timestamp: new Date().toISOString(),
      };

      // when & then
      await expect(worker.handleMessage(message)).rejects.toThrow(
        'MinIO 원문 파일 조회 실패',
      );
      // 저장되지 않았으므로 Qdrant 호출이 발생하지 않아야 함
      expect(qdrantService.upsertPoints).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage - DELETE 이벤트', () => {
    it('DELETE 메시지 수신 시 Qdrant에서 포인트를 삭제해야 한다', async () => {
      // given
      const message = {
        type: 'DELETE' as const,
        documentId: 'doc-to-delete',
        ownerId: 'user-admin',
        timestamp: new Date().toISOString(),
      };

      // when
      await worker.handleMessage(message);

      // then
      expect(qdrantService.deletePointsByDocument).toHaveBeenCalledWith(
        'user-admin',
        'doc-to-delete',
      );
    });
  });
});
