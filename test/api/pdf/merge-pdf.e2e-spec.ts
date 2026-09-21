import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { createTestPdfBuffer } from '../../lib/pdf-test.util.js';

describe('PDF Merge API (e2e) - POST /api/v1/pdf/merge', () => {
  const ctx = initE2ETest();
  const rootApiPath = '/api/v1/pdf/merge';

  it('2개의 PDF 파일을 성공적으로 병합하여 반환한다 (200 OK)', async () => {
    // given
    const pdf1 = await createTestPdfBuffer(2, '문서 1');
    const pdf2 = await createTestPdfBuffer(3, '문서 2');

    // when
    const res = await ctx.req
      .post(rootApiPath)
      .attach('files', pdf1, 'doc1.pdf')
      .attach('files', pdf2, 'doc2.pdf')
      .responseType('blob')
      .expect(200);

    // then
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(
      'attachment; filename="merged.pdf"',
    );

    // 실제 반환된 PDF의 총 페이지 수가 2 + 3 = 5인지 검증
    const mergedDoc = await PDFDocument.load(res.body);
    expect(mergedDoc.getPageCount()).toBe(5);
  });

  it('파일이 1개만 업로드된 경우 400 에러를 반환한다 (BR-P02)', async () => {
    // given
    const singlePdf = await createTestPdfBuffer(1);

    // when
    const res = await ctx.req
      .post(rootApiPath)
      .attach('files', singlePdf, 'doc1.pdf')
      .expect(400);

    // then
    expect(res.body.code).toBe('PDF_MIN_FILE_COUNT_NOT_MET');
  });
});
