import { describe, it, expect, beforeEach } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { withAuthHeaders, DEFAULT_TEST_USER, OTHER_TEST_USER } from '../../lib/utils.js';

describe('Markdown Documents API (E2E)', () => {
  const ctx = initE2ETest();

  beforeEach(async () => {
    await ctx.testService.cleanDatabase();
  });

  describe('POST /api/v1/markdown/documents', () => {
    it('마크다운 문서를 정상적으로 생성해야 한다 (201)', async () => {
      // given
      const payload = {
        title: '첫 번째 문서',
        content: '# 안녕 세상\n이것은 본문입니다.',
        tags: ['nestjs', 'typescript'],
      };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send(payload),
        DEFAULT_TEST_USER,
      ).expect(201);

      // then
      expect(res.body).toMatchObject({
        id: expect.any(String),
        title: '첫 번째 문서',
        currentVersion: 1,
        tags: ['nestjs', 'typescript'],
      });
    });

    it('제목이나 본문이 누락되면 400 Bad Request를 반환해야 한다', async () => {
      // given
      const invalidPayload = { title: '' };

      // when & then
      await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send(invalidPayload),
        DEFAULT_TEST_USER,
      ).expect(400);
    });
  });

  describe('GET /api/v1/markdown/documents', () => {
    it('문서 목록 및 페이지네이션을 올바르게 조회해야 한다 (200)', async () => {
      // given: 문서 2개 생성
      await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '문서 1',
          content: '본문 1',
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '문서 2',
          content: '본문 2',
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when
      const res = await withAuthHeaders(
        ctx.req.get('/api/v1/markdown/documents?page=1&limit=10'),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
    });

    it('타인의 문서는 목록에 노출되지 않아야 한다 (데이터 격리)', async () => {
      // given: OTHER_TEST_USER 문서 생성
      await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '타인 비밀 문서',
          content: '비밀',
        }),
        OTHER_TEST_USER,
      ).expect(201);

      // when: DEFAULT_TEST_USER로 목록 조회
      const res = await withAuthHeaders(
        ctx.req.get('/api/v1/markdown/documents'),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body.total).toBe(0);
      expect(res.body.items).toHaveLength(0);
    });

    it('cursor 기반 페이징으로 다음 페이지를 정확히 순차 조회해야 한다 (M-6 커서 페이징 지원)', async () => {
      // given: 문서 3개 순차 생성
      for (let i = 1; i <= 3; i++) {
        await withAuthHeaders(
          ctx.req.post('/api/v1/markdown/documents').send({
            title: `페이지네이션 문서 ${i}`,
            content: `내용 ${i}`,
          }),
          DEFAULT_TEST_USER,
        ).expect(201);
      }

      // when: 1페이지 (limit=2) 조회
      const page1 = await withAuthHeaders(
        ctx.req.get('/api/v1/markdown/documents?limit=2'),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then: 2개 반환 및 nextCursor 존재
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.nextCursor).toBe(page1.body.items[1].id);

      // when: 2페이지 (cursor 지정) 조회
      const page2 = await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents?limit=2&cursor=${page1.body.nextCursor}`),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then: 나머지 1개 반환 및 1페이지 아이템과 중복 없음
      expect(page2.body.items).toHaveLength(1);
      const page1Ids = page1.body.items.map((i: any) => i.id);
      expect(page1Ids).not.toContain(page2.body.items[0].id);
      expect(page2.body.nextCursor).toBeNull();
    });
  });

  describe('GET /api/v1/markdown/documents/:id', () => {
    it('문서 단건 및 본문을 정확히 조회해야 한다 (200)', async () => {
      // given
      const created = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '상세 조회 문서',
          content: '## 단건 본문 내용',
          tags: ['test'],
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when
      const res = await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${created.body.id}`),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body).toMatchObject({
        id: created.body.id,
        title: '상세 조회 문서',
        currentVersion: 1,
        tags: ['test'],
      });
      expect(res.body.content.trim()).toBe('## 단건 본문 내용');
    });

    it('존재하지 않거나 타인의 문서 조회 시 404를 반환해야 한다', async () => {
      // given
      const created = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '타인 소유 문서',
          content: '접근금지',
        }),
        OTHER_TEST_USER,
      ).expect(201);

      // when & then: DEFAULT_TEST_USER가 접근
      await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${created.body.id}`),
        DEFAULT_TEST_USER,
      ).expect(404);
    });
  });

  describe('PUT /api/v1/markdown/documents/:id', () => {
    it('문서 수정 시 currentVersion이 증가하고 내용이 갱신되어야 한다 (200)', async () => {
      // given
      const created = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '수정 전 제목',
          content: '수정 전 본문',
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when
      const res = await withAuthHeaders(
        ctx.req.put(`/api/v1/markdown/documents/${created.body.id}`).send({
          title: '수정 후 제목',
          content: '수정 후 본문',
          tags: ['updated'],
        }),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body).toMatchObject({
        title: '수정 후 제목',
        currentVersion: 2,
        tags: ['updated'],
      });
    });

    it('If-Match 헤더로 올바른 버전을 전달하면 정상 수정되어야 한다 (200)', async () => {
      // given
      const created = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '버전 매칭 테스트',
          content: '초기 본문',
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when: If-Match: "1" 전달
      const res = await withAuthHeaders(
        ctx.req
          .put(`/api/v1/markdown/documents/${created.body.id}`)
          .set('If-Match', '"1"')
          .send({
            title: '버전 매칭 수정',
            content: '수정 본문',
          }),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body.currentVersion).toBe(2);
    });

    it('If-Match 헤더로 일치하지 않는 버전을 전달하면 409 Conflict를 반환해야 한다 (낙관적 잠금 충돌 방어)', async () => {
      // given
      const created = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '버전 충돌 테스트',
          content: '초기 본문',
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when: 현재 버전은 1인데 If-Match: "99" 전달
      const res = await withAuthHeaders(
        ctx.req
          .put(`/api/v1/markdown/documents/${created.body.id}`)
          .set('If-Match', '"99"')
          .send({
            title: '충돌 유발 수정',
            content: '충돌 본문',
          }),
        DEFAULT_TEST_USER,
      ).expect(409);

      // then
      expect(res.body).toMatchObject({
        statusCode: 409,
        code: 'DOCUMENT_VERSION_CONFLICT',
      });
    });
  });

  describe('DELETE /api/v1/markdown/documents/:id', () => {
    it('문서를 성공적으로 삭제해야 한다 (204)', async () => {
      // given
      const created = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '삭제할 문서',
          content: '삭제 내용',
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when
      await withAuthHeaders(
        ctx.req.delete(`/api/v1/markdown/documents/${created.body.id}`),
        DEFAULT_TEST_USER,
      ).expect(204);

      // then: 다시 조회 시 404
      await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${created.body.id}`),
        DEFAULT_TEST_USER,
      ).expect(404);
    });
  });

  describe('Export API', () => {
    it('마크다운 파일로 정상 내보내기 되어야 한다 (200)', async () => {
      // given
      const created = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: '내보낼 문서',
          content: '# 내보내기 테스트',
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when
      const res = await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${created.body.id}/export/md`),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.header['content-type']).toContain('text/markdown');
      expect(res.text).toContain('# 내보내기 테스트');
    });
  });
});
