import { describe, it, expect } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { withAuthHeaders, DEFAULT_TEST_USER } from '../../lib/utils.js';

describe('Security: Frontmatter RCE Prevention (C-1 회귀 방지 E2E)', () => {
  const ctx = initE2ETest();

  it('---js 악성 실행 엔진 페이로드가 포함된 마크다운 임포트 시 400으로 거절되고 eval이 차단되어야 한다', async () => {
    // given: RCE를 유발하는 ---js 프론트매터 페이로드
    const maliciousPayload = [
      '---js',
      '{ title: "pwned-" + process.pid }',
      '---',
      '# Malicious Markdown',
      'This payload must not be evaluated.',
    ].join('\n');

    const fileBuffer = Buffer.from(maliciousPayload, 'utf-8');

    // when: .md 파일 업로드 시도
    const uploadReq = ctx.req
      .post('/api/v1/markdown/documents/import')
      .attach('file', fileBuffer, 'exploit.md');

    const res = await withAuthHeaders(uploadReq, DEFAULT_TEST_USER).expect(400);

    // then: MARKDOWN_UNSAFE_FRONTMATTER 에러 코드 및 RFC 7807 problem details 반환
    expect(res.body).toMatchObject({
      code: 'MARKDOWN_UNSAFE_FRONTMATTER',
      message: expect.stringContaining('보안 정책 위반'),
    });
  });

  it('---javascript 또는 ---coffee 등 실행 가능한 임의 엔진도 400으로 안전하게 차단되어야 한다', async () => {
    // given: ---coffee 엔진 페이로드
    const coffeePayload = [
      '---coffee',
      'title: "coffee-exploit"',
      '---',
      '# Coffee Header',
    ].join('\n');

    const fileBuffer = Buffer.from(coffeePayload, 'utf-8');

    // when & then
    const uploadReq = ctx.req
      .post('/api/v1/markdown/documents/import')
      .attach('file', fileBuffer, 'coffee.md');

    const res = await withAuthHeaders(uploadReq, DEFAULT_TEST_USER).expect(400);
    expect(res.body.code).toBe('MARKDOWN_UNSAFE_FRONTMATTER');
  });
});
