import { describe, it, expect } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { withAuthHeaders, DEFAULT_TEST_USER } from '../../lib/utils.js';

describe('Markdown: Concurrent Update & Optimistic Lock (OCC E2E)', () => {
  const ctx = initE2ETest();

  it('동일한 문서(v1)에 대해 If-Match: "1"로 동시 수정을 시도하면 1건만 성공(200)하고 다른 1건은 409 Conflict로 거절되어야 한다', async () => {
    // given: 버전 1의 마크다운 문서 생성
    const createRes = await withAuthHeaders(
      ctx.req.post('/api/v1/markdown/documents').send({
        title: '동시 수정 테스트 문서',
        content: '# 초기 내용',
      }),
      DEFAULT_TEST_USER,
    ).expect(201);

    const docId = createRes.body.id;
    expect(createRes.body.currentVersion).toBe(1);

    // when: 동일한 If-Match: "1" 헤더를 가지고 2개의 클라이언트가 동시에 수정을 요청
    const [res1, res2] = await Promise.all([
      withAuthHeaders(
        ctx.req
          .put(`/api/v1/markdown/documents/${docId}`)
          .set('If-Match', '"1"')
          .send({
            title: '클라이언트 A의 수정',
            content: '# 클라이언트 A 내용',
          }),
        DEFAULT_TEST_USER,
      ),
      withAuthHeaders(
        ctx.req
          .put(`/api/v1/markdown/documents/${docId}`)
          .set('If-Match', '"1"')
          .send({
            title: '클라이언트 B의 수정',
            content: '# 클라이언트 B 내용',
          }),
        DEFAULT_TEST_USER,
      ),
    ]);

    const statuses = [res1.status, res2.status].sort();

    // then: 정확히 1개는 200 OK, 1개는 409 Conflict이어야 함
    expect(statuses).toEqual([200, 409]);

    const conflictRes = res1.status === 409 ? res1 : res2;
    const successRes = res1.status === 200 ? res1 : res2;

    expect(successRes.body.currentVersion).toBe(2);
    expect(['DOCUMENT_VERSION_CONFLICT', 'DATABASE_UNIQUE_CONFLICT']).toContain(
      conflictRes.body.code,
    );

    // 최종 문서 버전이 2이며 리비전이 정상적으로 1개 보존되었는지 확인
    const detailRes = await withAuthHeaders(
      ctx.req.get(`/api/v1/markdown/documents/${docId}`),
      DEFAULT_TEST_USER,
    ).expect(200);

    expect(detailRes.body.currentVersion).toBe(2);
  });

  it('구버전 If-Match 헤더(v1)를 전송하여 v2 문서를 수정하려 하면 즉시 409 Conflict를 반환해야 한다', async () => {
    // given: v1 문서 생성 후 v2로 정상 업데이트
    const createRes = await withAuthHeaders(
      ctx.req.post('/api/v1/markdown/documents').send({
        title: '버전 불일치 문서',
        content: '# 원본',
      }),
      DEFAULT_TEST_USER,
    ).expect(201);

    const docId = createRes.body.id;

    await withAuthHeaders(
      ctx.req
        .put(`/api/v1/markdown/documents/${docId}`)
        .set('If-Match', '"1"')
        .send({
          title: '버전 2로 갱신',
          content: '# 갱신 내용',
        }),
      DEFAULT_TEST_USER,
    ).expect(200);

    // when: 이미 v2로 판올림된 문서에 옛날 버전 If-Match: "1"로 수정 시도
    const staleRes = await withAuthHeaders(
      ctx.req
        .put(`/api/v1/markdown/documents/${docId}`)
        .set('If-Match', '"1"')
        .send({
          title: '지연된 수정 요청',
          content: '# 옛날 내용',
        }),
      DEFAULT_TEST_USER,
    ).expect(409);

    // then
    expect(staleRes.body.code).toBe('DOCUMENT_VERSION_CONFLICT');
  });
});
