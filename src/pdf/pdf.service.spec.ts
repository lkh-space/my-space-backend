import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PdfService } from './pdf.service.js';
import { QpdfEngine } from './engines/qpdf.engine.js';
import { PdflibEngine } from './engines/pdflib.engine.js';
import { ZipEngine } from './engines/zip.engine.js';
import {
  PdfFileCountException,
  PdfNotProtectedException,
  PdfPasswordRequiredException,
} from './exceptions/pdf.exception.js';

describe('PdfService (BDD 단위 테스트)', () => {
  let service: PdfService;
  let qpdfEngine: QpdfEngine;
  let pdflibEngine: PdflibEngine;
  let zipEngine: ZipEngine;

  const sampleBuffer = Buffer.from('%PDF-1.4 dummy sample content');

  beforeEach(() => {
    qpdfEngine = {
      checkEncryption: vi.fn(),
      decrypt: vi.fn(),
      encrypt: vi.fn(),
    } as unknown as QpdfEngine;

    pdflibEngine = {
      getMetadata: vi.fn(),
      merge: vi.fn(),
      extractRanges: vi.fn(),
      splitToSinglePages: vi.fn(),
    } as unknown as PdflibEngine;

    zipEngine = {
      compressPages: vi.fn(),
    } as unknown as ZipEngine;

    service = new PdfService(qpdfEngine, pdflibEngine, zipEngine);
  });

  describe('inspect (UC-P00: 사전 검사)', () => {
    it('암호화되지 않은 PDF의 경우 isEncrypted=false와 메타데이터를 반환한다', async () => {
      // given
      vi.mocked(qpdfEngine.checkEncryption).mockResolvedValueOnce({
        isEncrypted: false,
        rawInfo: '',
      });
      vi.mocked(pdflibEngine.getMetadata).mockResolvedValueOnce({
        pageCount: 5,
        title: '사업계획서',
      });

      // when
      const result = await service.inspect(sampleBuffer);

      // then
      expect(result.isEncrypted).toBe(false);
      expect(result.pageCount).toBe(5);
      expect(result.metadata?.title).toBe('사업계획서');
    });

    it('암호화된 PDF에서 올바른 비밀번호 전달 시 복호화하여 메타데이터를 반환한다', async () => {
      // given
      vi.mocked(qpdfEngine.checkEncryption).mockResolvedValueOnce({
        isEncrypted: true,
        isPasswordValid: true,
        rawInfo: '',
      });
      vi.mocked(qpdfEngine.decrypt).mockResolvedValueOnce(
        Buffer.from('decrypted'),
      );
      vi.mocked(pdflibEngine.getMetadata).mockResolvedValueOnce({
        pageCount: 10,
        author: '홍길동',
      });

      // when
      const result = await service.inspect(sampleBuffer, 'correct-pw');

      // then
      expect(result.isEncrypted).toBe(true);
      expect(result.isPasswordValid).toBe(true);
      expect(result.pageCount).toBe(10);
      expect(result.metadata?.author).toBe('홍길동');
    });

    it('암호화된 PDF에서 비밀번호가 일치하지 않으면 메타데이터 없이 isPasswordValid=false를 반환한다', async () => {
      // given
      vi.mocked(qpdfEngine.checkEncryption).mockResolvedValueOnce({
        isEncrypted: true,
        isPasswordValid: false,
        rawInfo: '',
      });

      // when
      const result = await service.inspect(sampleBuffer, 'wrong-pw');

      // then
      expect(result.isEncrypted).toBe(true);
      expect(result.isPasswordValid).toBe(false);
      expect(result.pageCount).toBeUndefined();
    });
  });

  describe('unlock (UC-P04: 암호 해제)', () => {
    it('비밀번호가 전달되지 않으면 PdfPasswordRequiredException 예외를 던진다', async () => {
      // given
      const emptyPassword = '';

      // when & then
      await expect(service.unlock(sampleBuffer, emptyPassword)).rejects.toThrow(
        PdfPasswordRequiredException,
      );
    });

    it('암호화되지 않은 파일에 대해 암호 해제를 요청하면 PdfNotProtectedException 예외를 던진다', async () => {
      // given
      vi.mocked(qpdfEngine.checkEncryption).mockResolvedValueOnce({
        isEncrypted: false,
        rawInfo: '',
      });

      // when & then
      await expect(service.unlock(sampleBuffer, 'any-pw')).rejects.toThrow(
        PdfNotProtectedException,
      );
    });

    it('암호화된 파일과 올바른 비밀번호를 주면 복호화된 버퍼를 반환한다', async () => {
      // given
      const unlockedPdf = Buffer.from('unlocked pdf bytes');
      vi.mocked(qpdfEngine.checkEncryption).mockResolvedValueOnce({
        isEncrypted: true,
        rawInfo: '',
      });
      vi.mocked(qpdfEngine.decrypt).mockResolvedValueOnce(unlockedPdf);

      // when
      const result = await service.unlock(sampleBuffer, 'valid-pw');

      // then
      expect(result).toBe(unlockedPdf);
    });
  });

  describe('merge (UC-P01: PDF 병합)', () => {
    it('파일 개수가 2개 미만인 경우 PdfFileCountException 예외를 던진다', async () => {
      // given
      const singleFile = [{ buffer: sampleBuffer }];

      // when & then
      await expect(service.merge(singleFile)).rejects.toThrow(
        PdfFileCountException,
      );
    });

    it('2개 이상의 파일을 성공적으로 병합하여 반환한다', async () => {
      // given
      const files = [
        { buffer: Buffer.from('pdf1') },
        { buffer: Buffer.from('pdf2') },
      ];
      vi.mocked(qpdfEngine.checkEncryption).mockResolvedValue({
        isEncrypted: false,
        rawInfo: '',
      });
      const mergedBytes = Buffer.from('merged bytes');
      vi.mocked(pdflibEngine.merge).mockResolvedValueOnce(mergedBytes);

      // when
      const result = await service.merge(files);

      // then
      expect(result).toBe(mergedBytes);
      expect(pdflibEngine.merge).toHaveBeenCalledTimes(1);
    });

    it('병합 대상 중 암호화된 파일이 비밀번호 없이 전달되면 PdfPasswordRequiredException 예외를 던진다', async () => {
      // given
      const files = [
        { buffer: Buffer.from('pdf1') },
        { buffer: Buffer.from('pdf2') },
      ];
      vi.mocked(qpdfEngine.checkEncryption)
        .mockResolvedValueOnce({ isEncrypted: false, rawInfo: '' })
        .mockResolvedValueOnce({ isEncrypted: true, rawInfo: '' });

      // when & then
      await expect(service.merge(files)).rejects.toThrow(
        PdfPasswordRequiredException,
      );
    });
  });

  describe('splitRange (UC-P02: 범위 분할)', () => {
    it('지정된 페이지 범위를 추출하여 단일 PDF 버퍼로 반환한다', async () => {
      // given
      vi.mocked(qpdfEngine.checkEncryption).mockResolvedValueOnce({
        isEncrypted: false,
        rawInfo: '',
      });
      vi.mocked(pdflibEngine.getMetadata).mockResolvedValueOnce({
        pageCount: 10,
      });
      const extractedBytes = Buffer.from('extracted pdf bytes');
      vi.mocked(pdflibEngine.extractRanges).mockResolvedValueOnce(
        extractedBytes,
      );

      // when
      const result = await service.splitRange(sampleBuffer, '1-3, 5');

      // then
      expect(result).toBe(extractedBytes);
      expect(pdflibEngine.extractRanges).toHaveBeenCalledWith(
        sampleBuffer,
        [1, 2, 3, 5],
      );
    });
  });

  describe('splitAll (UC-P03: 전체 낱장 분할 ZIP)', () => {
    it('모든 페이지를 낱장으로 분할하고 ZIP으로 압축하여 반환한다', async () => {
      // given
      vi.mocked(qpdfEngine.checkEncryption).mockResolvedValueOnce({
        isEncrypted: false,
        rawInfo: '',
      });
      const singlePages = [
        { pageNumber: 1, buffer: Buffer.from('page 1') },
        { pageNumber: 2, buffer: Buffer.from('page 2') },
      ];
      vi.mocked(pdflibEngine.splitToSinglePages).mockResolvedValueOnce(
        singlePages,
      );
      const zipBytes = Buffer.from('zip bytes');
      vi.mocked(zipEngine.compressPages).mockResolvedValueOnce(zipBytes);

      // when
      const result = await service.splitAll(sampleBuffer);

      // then
      expect(result).toBe(zipBytes);
      expect(zipEngine.compressPages).toHaveBeenCalledWith(singlePages, 'page');
    });
  });
});
