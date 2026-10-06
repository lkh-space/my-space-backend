/// <reference types="multer" />
import { describe, it, expect } from 'vitest';
import {
  validateSinglePdf,
  validateMultiplePdfs,
} from './pdf-file.validator.js';
import {
  PdfCorruptedFileException,
  PdfFileSizeExceededException,
} from '../exceptions/pdf.exception.js';

describe('pdf-file.validator (BDD 단위 테스트)', () => {
  const validPdfBuffer = Buffer.from('%PDF-1.4 dummy content');

  const createMockFile = (
    buffer?: Buffer,
    size?: number,
  ): Express.Multer.File => {
    const buf = buffer ?? Buffer.alloc(0);
    return {
      buffer: buf,
      size: size ?? buf.length,
      fieldname: 'file',
      originalname: 'test.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };
  };

  describe('validateSinglePdf', () => {
    it('파일이 존재하지 않거나 빈 버퍼인 경우 PdfCorruptedFileException 예외를 던진다', () => {
      // given
      const emptyFile = createMockFile(Buffer.alloc(0));

      // when & then
      expect(() => validateSinglePdf(emptyFile)).toThrow(
        PdfCorruptedFileException,
      );
      expect(() => validateSinglePdf(undefined)).toThrow(
        PdfCorruptedFileException,
      );
    });

    it('파일 크기가 50MB를 초과하면 PdfFileSizeExceededException 예외를 던진다', () => {
      // given
      const oversizedFile = createMockFile(
        validPdfBuffer,
        50 * 1024 * 1024 + 1,
      );

      // when & then
      expect(() => validateSinglePdf(oversizedFile)).toThrow(
        PdfFileSizeExceededException,
      );
    });

    it('PDF 매직 넘버(%PDF-)로 시작하지 않는 파일은 PdfCorruptedFileException 예외를 던진다', () => {
      // given
      const invalidHeaderFile = createMockFile(
        Buffer.from('NOT_PDF_HEADER_DATA'),
      );

      // when & then
      expect(() => validateSinglePdf(invalidHeaderFile)).toThrow(
        PdfCorruptedFileException,
      );
    });

    it('유효한 PDF 파일인 경우 예외 없이 통과한다', () => {
      // given
      const validFile = createMockFile(validPdfBuffer);

      // when & then
      expect(() => validateSinglePdf(validFile)).not.toThrow();
    });
  });

  describe('validateMultiplePdfs', () => {
    it('파일 배열이 비어있거나 undefined인 경우 PdfCorruptedFileException 예외를 던진다', () => {
      // given
      const emptyFiles: Express.Multer.File[] = [];

      // when & then
      expect(() => validateMultiplePdfs(emptyFiles)).toThrow(
        PdfCorruptedFileException,
      );
      expect(() => validateMultiplePdfs(undefined)).toThrow(
        PdfCorruptedFileException,
      );
    });

    it('파일들 중 유효하지 않은 매직 넘버를 가진 파일이 포함되어 있으면 예외를 던진다', () => {
      // given
      const files = [
        createMockFile(validPdfBuffer),
        createMockFile(Buffer.from('INVALID_HEADER')),
      ];

      // when & then
      expect(() => validateMultiplePdfs(files)).toThrow(
        PdfCorruptedFileException,
      );
    });

    it('모든 파일 크기의 총합이 100MB를 초과하면 PdfFileSizeExceededException 예외를 던진다', () => {
      // given
      const files = [
        createMockFile(validPdfBuffer, 60 * 1024 * 1024),
        createMockFile(validPdfBuffer, 45 * 1024 * 1024),
      ];

      // when & then
      expect(() => validateMultiplePdfs(files)).toThrow(
        PdfFileSizeExceededException,
      );
    });

    it('모든 파일이 유효하고 총 크기가 100MB 이내인 경우 예외 없이 통과한다', () => {
      // given
      const files = [
        createMockFile(validPdfBuffer, 10 * 1024 * 1024),
        createMockFile(validPdfBuffer, 20 * 1024 * 1024),
      ];

      // when & then
      expect(() => validateMultiplePdfs(files)).not.toThrow();
    });
  });
});
