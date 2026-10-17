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

    it('동일한 이름의 루트 폴더를 동시에 생성 시도할 때 DB 레벨 부분 유니크 인덱스로 인해 중복 없이 방어되어야 한다 (M-5 루트 NULL 유니크 방어)', async () => {
      // given: 동일한 이름의 루트 폴더 생성 요청 4건 준비
      const folderName = '동시생성_루트';
      const requests = Array.from({ length: 4 }, () =>
        withAuthHeaders(
          ctx.req.post('/api/v1/markdown/folders').send({ name: folderName }),
          DEFAULT_TEST_USER,
        ),
      );

      // when: 4개 요청 동시 발송
      const responses = await Promise.all(requests);

      // then: 정확히 1개는 201 Created 성공, 나머지 3개는 409 Conflict(FOLDER_ALREADY_EXISTS 또는 DATABASE_UNIQUE_CONFLICT) 실패
      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(3);
      for (const conf of conflicts) {
        expect(['FOLDER_ALREADY_EXISTS', 'DATABASE_UNIQUE_CONFLICT']).toContain(
          conf.body.code,
        );
      }
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

    it('깊은 하위 계층 폴더로 상위 폴더를 이동하려고 하면 재귀 CTE 검사에 의해 400 Bad Request를 반환해야 한다 (순환 참조 방어)', async () => {
      // given: 루트 -> 1단계 -> 2단계 폴더 계층 생성
      const rootRes = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({ name: '루트' }),
        DEFAULT_TEST_USER,
      ).expect(201);
      const rootId = rootRes.body.id;

      const level1Res = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({
          name: '1단계',
          parentId: rootId,
        }),
        DEFAULT_TEST_USER,
      ).expect(201);
      const level1Id = level1Res.body.id;

      const level2Res = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({
          name: '2단계',
          parentId: level1Id,
        }),
        DEFAULT_TEST_USER,
      ).expect(201);
      const level2Id = level2Res.body.id;

      // when: 루트 폴더의 부모를 자신의 손자 폴더인 2단계 폴더로 이동 시도
      const res = await withAuthHeaders(
        ctx.req.patch(`/api/v1/markdown/folders/${rootId}`).send({
          parentId: level2Id,
        }),
        DEFAULT_TEST_USER,
      ).expect(400);

      // then: FOLDER_CYCLIC_DEPENDENCY 반환
      expect(res.body.code).toBe('FOLDER_CYCLIC_DEPENDENCY');
    });

    it('하위 폴더를 다른 루트 폴더로 정상 이동해야 한다 (200)', async () => {
      // given
      const rootA = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({ name: '루트A' }),
        DEFAULT_TEST_USER,
      ).expect(201);

      const rootB = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({ name: '루트B' }),
        DEFAULT_TEST_USER,
      ).expect(201);

      const sub = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({
          name: '서브',
          parentId: rootA.body.id,
        }),
        DEFAULT_TEST_USER,
      ).expect(201);

      // when: 서브의 부모를 루트B로 변경
      const res = await withAuthHeaders(
        ctx.req.patch(`/api/v1/markdown/folders/${sub.body.id}`).send({
          parentId: rootB.body.id,
        }),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body.parentId).toBe(rootB.body.id);
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
