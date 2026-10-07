import { describe, it, expect, beforeEach } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { withAuthHeaders, DEFAULT_TEST_USER } from '../../lib/utils.js';

describe('Markdown Revisions API (E2E)', () => {
  const ctx = initE2ETest();

  beforeEach(async () => {
    await ctx.testService.cleanDatabase();
  });

  describe('리비전 이력 및 비교/복원 플로우', () => {
    it('문서 수정 시 리비전이 누적되고, 비교 및 복원이 정상 작동해야 한다', async () => {
      // 1. 문서 최초 생성 (버전 1)
      const created = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '버전 테스트 문서',
          content: '첫 번째 원본 내용',
        }),
        DEFAULT_TEST_USER,
      ).expect(201);
      const docId = created.body.id;

      // 2. 문서 1차 수정 (버전 2)
      await withAuthHeaders(
        ctx.req.put(`/api/v1/markdown/documents/${docId}`).send({
          content: '두 번째 수정된 내용',
        }),
        DEFAULT_TEST_USER,
      ).expect(200);

      // 3. 문서 2차 수정 (버전 3)
      await withAuthHeaders(
        ctx.req.put(`/api/v1/markdown/documents/${docId}`).send({
          content: '세 번째 최종 내용',
        }),
        DEFAULT_TEST_USER,
      ).expect(200);

      // 4. 리비전 목록 조회 검증
      const revListRes = await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${docId}/revisions`),
        DEFAULT_TEST_USER,
      ).expect(200);

      expect(revListRes.body).toHaveLength(3);
      expect(revListRes.body.map((r: any) => r.version)).toEqual([3, 2, 1]);

      // 5. 과거 버전 1 상세 내용 조회
      const v1Res = await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${docId}/revisions/1`),
        DEFAULT_TEST_USER,
      ).expect(200);
      expect(v1Res.body.version).toBe(1);
      expect(v1Res.body.content.trim()).toBe('첫 번째 원본 내용');

      // 6. 과거 버전 1과 현재 버전 3 비교 (Diff)
      const compareRes = await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${docId}/revisions/compare?targetVersion=1`),
        DEFAULT_TEST_USER,
      ).expect(200);
      expect(compareRes.body.baseVersion).toBe(3);
      expect(compareRes.body.targetVersion).toBe(1);
      expect(compareRes.body.targetContent.trim()).toBe('첫 번째 원본 내용');

      // 7. 버전 1로 복원 (Restore) -> 새 버전 4 생성
      const restoreRes = await withAuthHeaders(
        ctx.req.post(`/api/v1/markdown/documents/${docId}/revisions/1/restore`),
        DEFAULT_TEST_USER,
      ).expect(201);

      expect(restoreRes.body.currentVersion).toBe(4);
      expect(restoreRes.body.content.trim()).toBe('첫 번째 원본 내용');
    });
  });
});
