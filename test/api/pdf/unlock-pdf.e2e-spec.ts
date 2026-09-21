import { describe, it, expect } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { createTestPdfBuffer } from '../../lib/pdf-test.util.js';

describe('PDF Unlock API (e2e) - POST /api/v1/pdf/unlock', () => {
  const ctx = initE2ETest();
  const rootApiPath = '/api/v1/pdf/unlock';

  it('암호화되지 않은 일반 PDF에 대해 암호 해제를 요청하면 400 에러를 반환한다', async () => {
    // given
    const sampleBuffer = await createTestPdfBuffer(2);

    // when
    const res = await ctx.req
      .post(rootApiPath)
      .attach('file', sampleBuffer, 'plain.pdf')
      .field('password', 'some-password')
      .expect(400);

    // then
    expect(res.body.code).toBe('PDF_NOT_PASSWORD_PROTECTED');
    expect(res.body.message).toContain('암호로 보호되어 있지 않습니다');
  });

  it('비밀번호 필드가 누락되거나 비어있으면 400 에러를 반환한다', async () => {
    // given
    const sampleBuffer = await createTestPdfBuffer(2);

    // when
    const res = await ctx.req
      .post(rootApiPath)
      .attach('file', sampleBuffer, 'plain.pdf')
      .expect(400);

    // then
    expect(res.body.code).toBe('PDF_PASSWORD_REQUIRED');
  });
});
