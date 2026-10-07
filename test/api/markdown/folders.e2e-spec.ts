import { describe, it, expect, beforeEach } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { withAuthHeaders, DEFAULT_TEST_USER, OTHER_TEST_USER } from '../../lib/utils.js';

describe('Markdown Folders API (E2E)', () => {
  const ctx = initE2ETest();

  beforeEach(async () => {
    await ctx.testService.cleanDatabase();
  });

  describe('POST /api/v1/markdown/folders', () => {
    it('루트 폴더를 정상적으로 생성해야 한다 (201)', async () => {
      // given
      const payload = { name: '개발 문서' };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send(payload),
        DEFAULT_TEST_USER,
      ).expect(201);

      // then
      expect(res.body).toMatchObject({
        id: expect.any(String),
        name: '개발 문서',
        parentId: null,
      });
    });

    it('하위 폴더를 정상적으로 생성해야 한다 (201)', async () => {
      // given: 부모 폴더 먼저 생성
      const parentRes = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({ name: '백엔드' }),
        DEFAULT_TEST_USER,
      ).expect(201);
      const parentId = parentRes.body.id;

      // when: 자식 폴더 생성
      const childRes = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({
          name: 'NestJS',
          parentId,
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // then
      expect(childRes.body).toMatchObject({
        name: 'NestJS',
        parentId,
      });
    });

    it('동일한 부모 위치에 중복된 이름의 폴더 생성 시 409를 반환해야 한다', async () => {
      // given
      await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({ name: '중복폴더' }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when & then
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({ name: '중복폴더' }),
        DEFAULT_TEST_USER,
      ).expect(409);

      expect(res.body.code).toBe('FOLDER_ALREADY_EXISTS');
    });
  });

  describe('GET /api/v1/markdown/folders', () => {
    it('계층형 폴더 트리를 올바르게 조회해야 한다 (200)', async () => {
      // given
      const parentRes = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({ name: '상위' }),
        DEFAULT_TEST_USER,
      ).expect(201);

      await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({
          name: '하위',
          parentId: parentRes.body.id,
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when
      const res = await withAuthHeaders(
        ctx.req.get('/api/v1/markdown/folders'),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('상위');
      expect(res.body[0].children).toHaveLength(1);
      expect(res.body[0].children[0].name).toBe('하위');
    });

    it('다른 사용자의 폴더는 조회되지 않아야 한다 (데이터 격리)', async () => {
      // given: OTHER_TEST_USER가 폴더 생성
      await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({ name: '타인폴더' }),
        OTHER_TEST_USER,
      ).expect(201);

      // when: DEFAULT_TEST_USER로 조회
      const res = await withAuthHeaders(
        ctx.req.get('/api/v1/markdown/folders'),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body).toHaveLength(0);
    });
  });

  describe('PATCH /api/v1/markdown/folders/:id', () => {
    it('폴더 이름을 성공적으로 수정해야 한다 (200)', async () => {
      // given
      const created = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({ name: '이전이름' }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when
      const res = await withAuthHeaders(
        ctx.req.patch(`/api/v1/markdown/folders/${created.body.id}`).send({
          name: '새이름',
        }),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body.name).toBe('새이름');
    });
  });

  describe('DELETE /api/v1/markdown/folders/:id', () => {
    it('폴더를 정상적으로 삭제해야 한다 (200)', async () => {
      // given
      const created = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({ name: '삭제할폴더' }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when
      await withAuthHeaders(
        ctx.req.delete(`/api/v1/markdown/folders/${created.body.id}`),
        DEFAULT_TEST_USER,
      ).expect(204);

      // then: 다시 조회 시 비어있어야 함
      const listRes = await withAuthHeaders(
        ctx.req.get('/api/v1/markdown/folders'),
        DEFAULT_TEST_USER,
      ).expect(200);
      expect(listRes.body).toHaveLength(0);
    });
  });
});
