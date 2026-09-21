import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { createTestPdfBuffer } from '../../lib/pdf-test.util.js';

describe('PDF Split APIs (e2e)', () => {
  const ctx = initE2ETest();

  describe('POST /api/v1/pdf/split/range', () => {
    const rangeApiPath = '/api/v1/pdf/split/range';

    it('지정한 페이지 범위(1-2, 4)를 성공적으로 추출하여 반환한다 (200 OK)', async () => {
      // given
      const samplePdf = await createTestPdfBuffer(5, '5페이지 문서');

      // when
      const res = await ctx.req
        .post(rangeApiPath)
        .attach('file', samplePdf, 'sample.pdf')
        .field('ranges', '1-2, 4')
        .responseType('blob')
        .expect(200);

      // then
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain(
        'attachment; filename="extracted.pdf"',
      );

      // 추출된 문서의 페이지 수가 3개인지 검증
      const extractedDoc = await PDFDocument.load(res.body);
      expect(extractedDoc.getPageCount()).toBe(3);
    });

    it('전체 페이지를 초과하는 범위를 지정하면 400 에러를 반환한다', async () => {
      // given
      const samplePdf = await createTestPdfBuffer(3);

      // when
      const res = await ctx.req
        .post(rangeApiPath)
        .attach('file', samplePdf, 'sample.pdf')
        .field('ranges', '1-5')
        .expect(400);

      // then
      expect(res.body.code).toBe('PDF_INVALID_PAGE_RANGE');
    });
  });

  describe('POST /api/v1/pdf/split/all', () => {
    const allApiPath = '/api/v1/pdf/split/all';

    it('모든 페이지를 낱장으로 분할하여 ZIP 파일로 반환한다 (200 OK)', async () => {
      // given
      const samplePdf = await createTestPdfBuffer(3);

      // when
      const res = await ctx.req
        .post(allApiPath)
        .attach('file', samplePdf, 'sample.pdf')
        .responseType('blob')
        .expect(200);

      // then
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toContain(
        'attachment; filename="split-pages.zip"',
      );

      const zipBytes = Buffer.from(res.body);
      // ZIP 매직 넘버 검증 (PK\x03\x04 -> 0x50, 0x4b, 0x03, 0x04)
      expect(zipBytes[0]).toBe(0x50);
      expect(zipBytes[1]).toBe(0x4b);
      expect(zipBytes[2]).toBe(0x03);
      expect(zipBytes[3]).toBe(0x04);
    });
  });
});
