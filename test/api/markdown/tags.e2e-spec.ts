import { describe, it, expect, beforeEach } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { withAuthHeaders, DEFAULT_TEST_USER } from '../../lib/utils.js';

describe('Markdown Tags API (E2E)', () => {
  const ctx = initE2ETest();

  beforeEach(async () => {
    await ctx.testService.cleanDatabase();
  });

  describe('GET /api/v1/markdown/tags', () => {
    it('문서에 연결된 태그 목록 및 카운트를 올바르게 집계해야 한다 (200)', async () => {
      // given: 문서 2개에 태그 부여
      await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '문서 A',
          content: '내용 A',
          tags: ['nestjs', 'backend'],
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '문서 B',
          content: '내용 B',
          tags: ['nestjs'],
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when
      const res = await withAuthHeaders(
        ctx.req.get('/api/v1/markdown/tags'),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body).toHaveLength(2);
      const nestjsTag = res.body.find((t: any) => t.name === 'nestjs');
      const backendTag = res.body.find((t: any) => t.name === 'backend');

      expect(nestjsTag).toBeDefined();
      expect(nestjsTag.documentCount).toBe(2);
      expect(backendTag).toBeDefined();
      expect(backendTag.documentCount).toBe(1);
    });

    it('동일한 태그를 포함하는 다수의 문서가 동시에 생성되어도 P2002 충돌 없이 원자적으로 처리되어야 한다 (M-4 경쟁 조건 방어)', async () => {
      // given: 동일한 태그들을 공유하는 5건의 문서 생성 요청 준비
      const sharedTags = ['concurrency', 'shared-tag', 'fast'];
      const requests = Array.from({ length: 5 }, (_, i) =>
        withAuthHeaders(
          ctx.req.post('/api/v1/markdown/documents').send({
            title: `동시 문서 ${i + 1}`,
            content: `동시 본문 내용 ${i + 1}`,
            tags: sharedTags,
          }),
          DEFAULT_TEST_USER,
        ),
      );

      // when: 5개의 요청을 병렬로 동시 실행
      const results = await Promise.all(requests);

      // then: 모든 요청이 201 Created로 성공해야 함 (P2002 에러 없음)
      for (const res of results) {
        expect(res.status).toBe(201);
        expect(res.body.tags).toEqual(expect.arrayContaining(sharedTags));
      }

      // 태그 조회 시 중복 없이 정확히 3개의 태그만 생성되고 각 카운트가 5이어야 함
      const tagsRes = await withAuthHeaders(
        ctx.req.get('/api/v1/markdown/tags'),
        DEFAULT_TEST_USER,
      ).expect(200);

      expect(tagsRes.body).toHaveLength(3);
      for (const tag of tagsRes.body) {
        expect(sharedTags).toContain(tag.name);
        expect(tag.documentCount).toBe(5);
      }
    });
  });
});
