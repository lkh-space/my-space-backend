import { describe, it, expect, beforeEach } from 'vitest';
import { initAiE2ETest } from '../lib/init-ai-e2e-test.js';
import { IndexingConsumerWorker } from '../../apps/ai/src/indexing/indexing-consumer.worker.js';
import { DEFAULT_TEST_USER } from '../lib/utils.js';

describe('AI Indexing Worker (E2E Integration)', () => {
  const ctx = initAiE2ETest();
  let worker: IndexingConsumerWorker;

  beforeEach(async () => {
    worker = ctx.module.get(IndexingConsumerWorker);
    await ctx.testService.cleanDatabase();
    ctx.fakeQdrant.clear();
    ctx.fakeMinio.clear();
  });

  describe('handleMessage - INDEX 이벤트', () => {
    it('MinIO의 마크다운 원문을 다운로드하여 청킹 및 벡터 색인을 수행해야 한다', async () => {
      // given
      const documentId = 'doc-test-indexing';
      const ownerId = DEFAULT_TEST_USER.user!;
      const markdownContent = [
        '# 첫 번째 섹션',
        '이것은 첫 번째 섹션의 본문입니다.',
        '## 두 번째 섹션',
        '두 번째 섹션의 상세 설명입니다.',
      ].join('\n\n');

      const objectKey = `docs/${ownerId}/${documentId}/current.md`;
      await ctx.fakeMinio.putObject(
        ctx.fakeMinio.docsBucket,
        objectKey,
        markdownContent,
      );

      // when
      await worker.handleMessage({
        type: 'INDEX',
        documentId,
        ownerId,
        version: 1,
        title: '색인 테스트 문서',
        tags: ['test', 'index'],
        timestamp: new Date().toISOString(),
      });

      // then
      const points = ctx.fakeQdrant.getAllPoints();
      expect(points.length).toBeGreaterThanOrEqual(1);

      const firstPoint = points[0];
      expect(firstPoint.payload).toMatchObject({
        ownerId,
        documentId,
        title: '색인 테스트 문서',
        version: 1,
        tags: ['test', 'index'],
      });
      expect(firstPoint.vector).toHaveLength(768);
    });
  });

  describe('handleMessage - DELETE 이벤트', () => {
    it('문서 삭제 이벤트 수신 시 Qdrant에서 해당 문서의 모든 청크를 제거해야 한다', async () => {
      // given: FakeQdrant에 사전 포인트 등록
      const documentId = 'doc-to-delete';
      const ownerId = DEFAULT_TEST_USER.user!;

      await ctx.fakeQdrant.upsertPoints([
        {
          id: 'chunk-del-1',
          vector: Array.from({ length: 768 }, () => 0.05),
          payload: {
            ownerId,
            documentId,
            chunkIndex: 0,
            title: '삭제 대상 문서',
            heading: '제목',
            content: '내용',
          },
        },
      ]);

      expect(ctx.fakeQdrant.getAllPoints()).toHaveLength(1);

      // when
      await worker.handleMessage({
        type: 'DELETE',
        documentId,
        ownerId,
        timestamp: new Date().toISOString(),
      });

      // then
      expect(ctx.fakeQdrant.getAllPoints()).toHaveLength(0);
    });
  });
});
