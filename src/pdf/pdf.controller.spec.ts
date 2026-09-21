/// <reference types="multer" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PdfController } from './pdf.controller.js';
import { PdfService } from './pdf.service.js';
import {
  PdfCorruptedFileException,
  PdfFileSizeExceededException,
} from './exceptions/pdf.exception.js';
import type { Response } from 'express';

describe('PdfController (BDD 단위 테스트)', () => {
  let controller: PdfController;
  let service: PdfService;

  const validPdfBuffer = Buffer.from('%PDF-1.4 dummy valid bytes');

  const mockFile = (
    buffer: Buffer,
    size = buffer.length,
  ): Express.Multer.File => ({
    buffer,
    size,
    fieldname: 'file',
    originalname: 'sample.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    destination: '',
    filename: '',
    path: '',
    stream: null as any,
  });

  const mockResponse = (): Response => {
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    return res as Response;
  };

  beforeEach(() => {
    service = {
      inspect: vi.fn(),
      unlock: vi.fn(),
      merge: vi.fn(),
      splitRange: vi.fn(),
      splitAll: vi.fn(),
    } as unknown as PdfService;

    controller = new PdfController(service);
  });

  describe('inspect (POST /api/v1/pdf/inspect)', () => {
    it('유효한 PDF 파일 전달 시 사전 검사 결과를 반환한다', async () => {
      // given
      const file = mockFile(validPdfBuffer);
      const expectedResult = { isEncrypted: false, pageCount: 3 };
      vi.mocked(service.inspect).mockResolvedValueOnce(expectedResult);

      // when
      const result = await controller.inspect(file, { password: 'pw' });

      // then
      expect(result).toBe(expectedResult);
      expect(service.inspect).toHaveBeenCalledWith(validPdfBuffer, 'pw');
    });

    it('PDF 매직 넘버가 없는 파일인 경우 PdfCorruptedFileException 예외를 던진다', async () => {
      // given
      const invalidFile = mockFile(Buffer.from('not a pdf header content'));

      // when & then
      await expect(controller.inspect(invalidFile, {})).rejects.toThrow(
        PdfCorruptedFileException,
      );
    });

    it('50MB 초과 파일인 경우 PdfFileSizeExceededException 예외를 던진다', async () => {
      // given
      const oversizedFile = mockFile(validPdfBuffer, 51 * 1024 * 1024);

      // when & then
      await expect(controller.inspect(oversizedFile, {})).rejects.toThrow(
        PdfFileSizeExceededException,
      );
    });
  });

  describe('unlock (POST /api/v1/pdf/unlock)', () => {
    it('암호 해제 성공 시 application/pdf 헤더와 함께 파일을 다운로드 응답한다', async () => {
      // given
      const file = mockFile(validPdfBuffer);
      const res = mockResponse();
      const unlockedPdf = Buffer.from('%PDF-1.4 unlocked content');
      vi.mocked(service.unlock).mockResolvedValueOnce(unlockedPdf);

      // when
      await controller.unlock(file, { password: 'secret' }, res);

      // then
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="unlocked.pdf"',
      );
      expect(res.send).toHaveBeenCalledWith(unlockedPdf);
    });
  });

  describe('merge (POST /api/v1/pdf/merge)', () => {
    it('파일 배열 전달 시 병합된 PDF를 다운로드 응답한다', async () => {
      // given
      const files = [mockFile(validPdfBuffer), mockFile(validPdfBuffer)];
      const res = mockResponse();
      const mergedPdf = Buffer.from('%PDF-1.4 merged content');
      vi.mocked(service.merge).mockResolvedValueOnce(mergedPdf);

      // when
      await controller.merge(files, { passwords: '["pw1", ""]' }, res);

      // then
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="merged.pdf"',
      );
      expect(res.send).toHaveBeenCalledWith(mergedPdf);
    });
  });

  describe('split/range (POST /api/v1/pdf/split/range)', () => {
    it('범위 분할 성공 시 extracted.pdf 파일로 다운로드 응답한다', async () => {
      // given
      const file = mockFile(validPdfBuffer);
      const res = mockResponse();
      const extractedPdf = Buffer.from('%PDF-1.4 extracted content');
      vi.mocked(service.splitRange).mockResolvedValueOnce(extractedPdf);

      // when
      await controller.splitRange(file, { ranges: '1-2', password: 'pw' }, res);

      // then
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="extracted.pdf"',
      );
      expect(res.send).toHaveBeenCalledWith(extractedPdf);
    });
  });

  describe('split/all (POST /api/v1/pdf/split/all)', () => {
    it('전체 분할 성공 시 application/zip 헤더와 함께 ZIP 파일로 다운로드 응답한다', async () => {
      // given
      const file = mockFile(validPdfBuffer);
      const res = mockResponse();
      const zipBytes = Buffer.from('dummy zip');
      vi.mocked(service.splitAll).mockResolvedValueOnce(zipBytes);

      // when
      await controller.splitAll(file, {}, res);

      // then
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/zip',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="split-pages.zip"',
      );
      expect(res.send).toHaveBeenCalledWith(zipBytes);
    });
  });
});
