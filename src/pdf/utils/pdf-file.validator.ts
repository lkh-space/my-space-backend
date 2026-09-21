/// <reference types="multer" />
import {
  PdfCorruptedFileException,
  PdfFileSizeExceededException,
} from '../exceptions/pdf.exception.js';

export const MAX_SINGLE_FILE_SIZE = 50 * 1024 * 1024; // 50MB (BR-P03)
export const MAX_TOTAL_FILES_SIZE = 100 * 1024 * 1024; // 100MB (BR-P03)
export const PDF_MAGIC_BYTES = Buffer.from('%PDF-'); // BR-P01

/**
 * 단일 PDF 파일의 유효성(존재 여부, 크기 50MB 제한, 매직 넘버)을 검증합니다.
 */
export function validateSinglePdf(file?: Express.Multer.File): void {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new PdfCorruptedFileException(
      '업로드된 PDF 파일이 비어있거나 존재하지 않습니다.',
    );
  }

  if (file.size > MAX_SINGLE_FILE_SIZE) {
    throw new PdfFileSizeExceededException(
      `파일 크기(${Math.round(file.size / (1024 * 1024))}MB)가 최대 허용 크기(50MB)를 초과했습니다.`,
    );
  }

  // 매직 넘버 검증 (%PDF-)
  if (
    file.buffer.length < PDF_MAGIC_BYTES.length ||
    !file.buffer.subarray(0, 5).equals(PDF_MAGIC_BYTES)
  ) {
    throw new PdfCorruptedFileException(
      '유효하지 않은 PDF 파일 형식입니다. (매직 넘버 불일치)',
    );
  }
}

/**
 * 복수 PDF 파일 목록의 유효성(존재 여부, 개별 파일 유효성, 총합 크기 100MB 제한)을 검증합니다.
 */
export function validateMultiplePdfs(files?: Express.Multer.File[]): void {
  if (!files || files.length === 0) {
    throw new PdfCorruptedFileException('병합할 PDF 파일을 첨부해주세요.');
  }

  let totalSize = 0;
  for (const f of files) {
    validateSinglePdf(f);
    totalSize += f.size;
  }

  if (totalSize > MAX_TOTAL_FILES_SIZE) {
    throw new PdfFileSizeExceededException(
      `총 파일 크기(${Math.round(totalSize / (1024 * 1024))}MB)가 최대 허용 크기(100MB)를 초과했습니다.`,
    );
  }
}
