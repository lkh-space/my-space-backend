import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdflibEngine } from './pdflib.engine.js';
import { PdfCorruptedFileException } from '../exceptions/pdf.exception.js';

describe('PdflibEngine (단위 테스트)', () => {
  let engine: PdflibEngine;

  beforeEach(() => {
    engine = new PdflibEngine();
  });

  async function createSamplePdf(
    pageCount = 3,
    title = 'Sample Title',
  ): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.setTitle(title);
    for (let i = 0; i < pageCount; i++) {
      doc.addPage([200, 200]);
    }
    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  it('PDF 메타데이터 및 페이지 수를 정확히 조회한다', async () => {
    // given
    const sampleBuffer = await createSamplePdf(3, 'Test Document');

    // when
    const meta = await engine.getMetadata(sampleBuffer);

    // then
    expect(meta.pageCount).toBe(3);
    expect(meta.title).toBe('Test Document');
  });

  it('2개 이상의 PDF를 성공적으로 병합한다', async () => {
    // given
    const pdf1 = await createSamplePdf(2);
    const pdf2 = await createSamplePdf(3);

    // when
    const merged = await engine.merge([pdf1, pdf2]);
    const mergedDoc = await PDFDocument.load(merged);

    // then
    expect(mergedDoc.getPageCount()).toBe(5);
  });

  it('지정한 페이지 번호 범위만 성공적으로 추출한다', async () => {
    // given
    const pdf = await createSamplePdf(5);
    const targetPages = [1, 3, 5];

    // when
    const extracted = await engine.extractRanges(pdf, targetPages);
    const extractedDoc = await PDFDocument.load(extracted);

    // then
    expect(extractedDoc.getPageCount()).toBe(3);
  });

  it('모든 페이지를 낱장 PDF로 분할한다', async () => {
    // given
    const pdf = await createSamplePdf(4);

    // when
    const results = await engine.splitToSinglePages(pdf);

    // then
    expect(results).toHaveLength(4);
    expect(results[0].pageNumber).toBe(1);
    expect(results[3].pageNumber).toBe(4);

    const firstPageDoc = await PDFDocument.load(results[0].buffer);
    expect(firstPageDoc.getPageCount()).toBe(1);
  });

  it('손상된 버퍼 입력 시 PdfCorruptedFileException 예외를 던진다', async () => {
    // given
    const corruptedBuffer = Buffer.from('not a valid pdf content');

    // when & then
    await expect(engine.getMetadata(corruptedBuffer)).rejects.toThrow(
      PdfCorruptedFileException,
    );
  });
});
