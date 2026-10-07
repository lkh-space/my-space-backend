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
  });
});
