import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IndexingConsumerWorker } from './indexing-consumer.worker.js';
import { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { QdrantService } from '@app/storage/qdrant/qdrant.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import { generateDeterministicChunkId } from '../utils/uuid-v5.js';

describe('IndexingConsumerWorker (인덱싱 워커 H-4 멱등성 및 원자적 색인 단위 테스트)', () => {
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
      deleteOldVersionsByDocument: vi.fn().mockResolvedValue(undefined),
      getLatestVersionForDocument: vi.fn().mockResolvedValue(null),
      upsertPoints: vi.fn().mockResolvedValue(undefined),
    } as unknown as QdrantService;

    minioService = {
      docsBucket: 'my-space-markdown',
      getObjectAsString: vi.fn(),
    } as unknown as MinioService;

    mockEmbeddingProvider = {
      name: 'gemini',
      embeddingModel: 'gemini-embedding-001',
      embedText: vi.fn().mockResolvedValue(Array.from({ length: 768 }, () => 0.1)),
      embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
        return texts.map(() => Array.from({ length: 768 }, () => 0.1));
      }),
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

  describe('handleMessage - INDEX 이벤트 (H-4 멱등성 및 Zero-downtime 검증)', () => {
    it('정상 인덱싱 시 결정적 UUID로 Zero-downtime Upsert를 수행하고 구버전을 삭제해야 한다', async () => {
      // given
      const rawMarkdown = '# 섹션 1\n내용 1\n\n## 섹션 2\n내용 2';
      vi.mocked(minioService.getObjectAsString).mockResolvedValueOnce(rawMarkdown);

      const message = {
        type: 'INDEX' as const,
        documentId: 'doc-1',
        ownerId: 'user-admin',
        version: 2,
        title: '테스트 문서',
        tags: ['test'],
        timestamp: new Date().toISOString(),
      };

      const callOrder: string[] = [];
      vi.mocked(qdrantService.upsertPoints).mockImplementation(async () => {
        callOrder.push('upsertPoints');
      });
      vi.mocked(qdrantService.deleteOldVersionsByDocument).mockImplementation(async () => {
        callOrder.push('deleteOldVersionsByDocument');
      });

      // when
      await worker.handleMessage(message);

      // then
      // 1. MinIO 로드 및 배치 임베딩 호출 확인
      expect(minioService.getObjectAsString).toHaveBeenCalledWith(
        'my-space-markdown',
        'docs/user-admin/doc-1/current.md',
      );
      expect(mockEmbeddingProvider.embedBatch).toHaveBeenCalled();

      // 2. 결정적 UUID가 포인트 ID로 지정되었는지 확인
      const expectedFirstChunkId = generateDeterministicChunkId('doc-1', 0);
      expect(qdrantService.upsertPoints).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: expectedFirstChunkId,
            payload: expect.objectContaining({
              version: 2,
              documentId: 'doc-1',
              embeddingModel: 'gemini-embedding-001',
            }),
          }),
        ]),
      );

      // 3. 순서 검증: 검색 공백 방지를 위해 upsertPoints가 deleteOldVersionsByDocument보다 먼저 실행되어야 함
      expect(callOrder).toEqual(['upsertPoints', 'deleteOldVersionsByDocument']);
      expect(qdrantService.deleteOldVersionsByDocument).toHaveBeenCalledWith(
        'user-admin',
        'doc-1',
        2,
      );
    });

    it('이미 더 최신 버전이 색인되어 있으면 구버전 이벤트를 건너뛰어야 한다 (Out-of-order 방어)', async () => {
      // given: 이미 v3이 Qdrant에 색인되어 있음
      vi.mocked(qdrantService.getLatestVersionForDocument).mockResolvedValueOnce(3);

      const message = {
        type: 'INDEX' as const,
        documentId: 'doc-1',
        ownerId: 'user-admin',
        version: 2, // 지연되어 늦게 도착한 구버전
        title: '구버전 문서',
        timestamp: new Date().toISOString(),
      };

      // when
      await worker.handleMessage(message);

      // then: MinIO 및 Qdrant 업서트를 일절 호출하지 않고 무시해야 함
      expect(minioService.getObjectAsString).not.toHaveBeenCalled();
      expect(qdrantService.upsertPoints).not.toHaveBeenCalled();
      expect(qdrantService.deleteOldVersionsByDocument).not.toHaveBeenCalled();
    });

    it('배치 임베딩 실패 시 예외를 throw하여 부분 인덱스 생성을 방지해야 한다 (원자성 All-or-Nothing)', async () => {
      // given
      const rawMarkdown = '# 섹션 1\n내용';
      vi.mocked(minioService.getObjectAsString).mockResolvedValueOnce(rawMarkdown);
      vi.mocked(mockEmbeddingProvider.embedBatch).mockRejectedValueOnce(
        new Error('Embedding API rate limit'),
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
        'Embedding API rate limit',
      );
      // 실패 시 어떠한 Qdrant 업서트나 삭제도 일어나지 않아야 함
      expect(qdrantService.upsertPoints).not.toHaveBeenCalled();
      expect(qdrantService.deleteOldVersionsByDocument).not.toHaveBeenCalled();
    });

    it('MinIO 원문 로드 실패 시 에러를 throw하여 상위 재시도 메커니즘에 전달해야 한다 (H-3/H-4)', async () => {
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
      expect(qdrantService.upsertPoints).not.toHaveBeenCalled();
    });

    it('동일한 메시지가 재전달(redelivery)되어도 결정적 UUID를 통해 멱등하게 덮어써져야 한다', async () => {
      // given: 동일한 내용과 버전의 문서 메시지
      const rawMarkdown = '# 재전달 테스트\n동일 내용 청크';
      vi.mocked(minioService.getObjectAsString).mockResolvedValue(rawMarkdown);

      const message = {
        type: 'INDEX' as const,
        documentId: 'doc-redelivery',
        ownerId: 'user-admin',
        version: 1,
        title: '재전달 문서',
        timestamp: new Date().toISOString(),
      };

      // when: 동일 메시지 2회 처리 (Redelivery 시뮬레이션)
      await worker.handleMessage(message);
      await worker.handleMessage(message);

      // then: 2회 모두 동일한 결정적 chunk ID를 사용하여 upsertPoints 호출
      expect(qdrantService.upsertPoints).toHaveBeenCalledTimes(2);
      const expectedChunkId = generateDeterministicChunkId('doc-redelivery', 0);

      const firstCallArgs = vi.mocked(qdrantService.upsertPoints).mock.calls[0][0];
      const secondCallArgs = vi.mocked(qdrantService.upsertPoints).mock.calls[1][0];

      expect(firstCallArgs[0].id).toBe(expectedChunkId);
      expect(secondCallArgs[0].id).toBe(expectedChunkId);
      // ID가 동일하므로 Qdrant 레벨에서 포인트가 증식되지 않고 덮어써짐이 보장됨
    });

    it('Qdrant upsertPoints 실패 시 에러를 throw하여 컨슈머의 nack 및 DLQ 전파를 유도해야 한다', async () => {
      // given
      const rawMarkdown = '# 장애 테스트';
      vi.mocked(minioService.getObjectAsString).mockResolvedValueOnce(rawMarkdown);
      vi.mocked(qdrantService.upsertPoints).mockRejectedValueOnce(
        new Error('Qdrant connection refused'),
      );

      const message = {
        type: 'INDEX' as const,
        documentId: 'doc-qdrant-fail',
        ownerId: 'user-admin',
        version: 1,
        title: '실패 문서',
        timestamp: new Date().toISOString(),
      };

      // when & then
      await expect(worker.handleMessage(message)).rejects.toThrow(
        'Qdrant connection refused',
      );
      // Qdrant 저장 실패 시 구버전 삭제가 실행되지 않아야 데이터 유실 방지
      expect(qdrantService.deleteOldVersionsByDocument).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage - DELETE 이벤트', () => {
    it('DELETE 메시지 수신 시 Qdrant에서 해당 문서의 모든 포인트를 삭제해야 한다', async () => {
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

  describe('분산 추적 (Distributed Tracing) 연동', () => {
    it('TraceContextService에 requestId가 설정되어 있으면 로그 메시지에 [reqId=...] 접두사가 포함되어야 한다', async () => {
      // given
      const { TraceContextService } = await import('@app/common');
      const traceContextService = new TraceContextService();
      const tracingWorker = new IndexingConsumerWorker(
        rabbitmqService,
        qdrantService,
        minioService,
        providerFactory,
        traceContextService,
      );

      const logSpy = vi.spyOn((tracingWorker as any).logger, 'log');

      const message = {
        type: 'DELETE' as const,
        documentId: 'doc-trace-del',
        ownerId: 'user-trace',
        timestamp: new Date().toISOString(),
      };

      // when: 활성화된 TraceContext 내에서 메시지 처리
      await traceContextService.runWithContext(
        { requestId: 'http-req-trace-555' },
        async () => {
          await tracingWorker.handleMessage(message);
        },
      );

      // then
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[reqId=http-req-trace-555]'),
      );
    });
  });
});
