import { PDFDocument } from 'pdf-lib';

/**
 * E2E 테스트용 유효한 샘플 PDF 버퍼를 메모리 상에서 생성합니다.
 */
export async function createTestPdfBuffer(
  pageCount = 3,
  title = 'Test Sample Document',
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([200, 200]);
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
