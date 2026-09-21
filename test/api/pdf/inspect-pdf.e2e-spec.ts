import { describe, it, expect } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { createTestPdfBuffer } from '../../lib/pdf-test.util.js';

describe('PDF Inspect API (e2e) - POST /api/v1/pdf/inspect', () => {
  const ctx = initE2ETest();
  const rootApiPath = '/api/v1/pdf/inspect';

  it('일반 PDF 파일 업로드 시 암호화되지 않음 상태와 메타데이터를 반환한다 (200 OK)', async () => {
    // given
    const sampleBuffer = await createTestPdfBuffer(3, '2026 사업계획서');

    // when
    const res = await ctx.req
      .post(rootApiPath)
      .attach('file', sampleBuffer, 'sample.pdf')
      .expect(200);

    // then
    expect(res.body).toMatchObject({
      isEncrypted: false,
      pageCount: 3,
    });
    expect(res.body.metadata.title).toBe('2026 사업계획서');
  });

  it('PDF 매직 넘버가 없는 손상된 파일을 업로드하면 422 에러를 반환한다', async () => {
    // given
    const corruptedBuffer = Buffer.from('this is plain text, not a pdf');

    // when
    const res = await ctx.req
      .post(rootApiPath)
      .attach('file', corruptedBuffer, 'corrupted.pdf')
      .expect(422);

    // then
    expect(res.body.code).toBe('PDF_CORRUPTED_FILE');
    expect(res.body.message).toContain('유효하지 않은 PDF');
  });
});
