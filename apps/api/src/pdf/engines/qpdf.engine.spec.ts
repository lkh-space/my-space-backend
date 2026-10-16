import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { QpdfEngine } from './qpdf.engine.js';
import {
  PdfCorruptedFileException,
  PdfInvalidPasswordException,
  PdfPasswordRequiredException,
} from '../exceptions/pdf.exception.js';

describe('QpdfEngine (단위 테스트)', () => {
  let engine: QpdfEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new QpdfEngine();
  });

  const dummyPdf = Buffer.from('%PDF-1.4 dummy content');

  describe('checkEncryption', () => {
    it('암호화되지 않은 PDF의 경우 isEncrypted=false를 반환한다', async () => {
      // given
      vi.spyOn(engine, 'runQpdf').mockResolvedValueOnce({
        stdout: Buffer.from('File is not encrypted'),
        stderr: Buffer.from(''),
        exitCode: 0,
      });

      // when
      const status = await engine.checkEncryption(dummyPdf);

      // then
      expect(status.isEncrypted).toBe(false);
      expect(status.isPasswordValid).toBeUndefined();
    });

    it('암호화된 PDF에서 비밀번호가 일치하면 isPasswordValid=true를 반환한다', async () => {
      // given
      vi.spyOn(engine, 'runQpdf')
        .mockResolvedValueOnce({
          stdout: Buffer.from('R = 6 (AES-256)'),
          stderr: Buffer.from(''),
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        });

      // when
      const status = await engine.checkEncryption(dummyPdf, 'correct-password');

      // then
      expect(status.isEncrypted).toBe(true);
      expect(status.isPasswordValid).toBe(true);
    });

    it('암호화된 PDF에서 비밀번호가 일치하지 않으면 isPasswordValid=false를 반환한다', async () => {
      // given
      vi.spyOn(engine, 'runQpdf')
        .mockResolvedValueOnce({
          stdout: Buffer.from('R = 6 (AES-256)'),
          stderr: Buffer.from(''),
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: Buffer.from(''),
          stderr: Buffer.from('qpdf: invalid password'),
          exitCode: 2,
        });

      // when
      const status = await engine.checkEncryption(dummyPdf, 'wrong-password');

      // then
      expect(status.isEncrypted).toBe(true);
      expect(status.isPasswordValid).toBe(false);
    });

    it('손상된 PDF 파일일 경우 PdfCorruptedFileException을 던진다', async () => {
      // given
      vi.spyOn(engine, 'runQpdf').mockResolvedValueOnce({
        stdout: Buffer.from(''),
        stderr: Buffer.from("qpdf: can't find pdf header: file is damaged"),
        exitCode: 2,
      });

      // when & then
      await expect(engine.checkEncryption(dummyPdf)).rejects.toThrow(
        PdfCorruptedFileException,
      );
    });
  });

  describe('decrypt', () => {
    it('올바른 비밀번호로 복호화 요청 시 복호화된 버퍼를 반환한다', async () => {
      // given
      const expectedBytes = Buffer.from('%PDF-1.4 clean decrypted bytes');
      vi.spyOn(engine, 'runQpdf').mockImplementation(async (args) => {
        // args의 마지막 인자가 outputPath
        const outputPath = args[args.length - 1];
        await fs.writeFile(outputPath, expectedBytes);
        return {
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        };
      });

      // when
      const result = await engine.decrypt(dummyPdf, 'correct-pw');

      // then
      expect(result).toEqual(expectedBytes);
    });

    it('비밀번호가 틀렸을 때 PdfInvalidPasswordException 예외를 던진다', async () => {
      // given
      vi.spyOn(engine, 'runQpdf').mockResolvedValueOnce({
        stdout: Buffer.from(''),
        stderr: Buffer.from('qpdf: invalid password'),
        exitCode: 2,
      });

      // when & then
      await expect(engine.decrypt(dummyPdf, 'wrong-pw')).rejects.toThrow(
        PdfInvalidPasswordException,
      );
    });

    it('암호화된 파일에 비밀번호를 제공하지 않았을 때 PdfPasswordRequiredException 예외를 던진다', async () => {
      // given
      vi.spyOn(engine, 'runQpdf').mockResolvedValueOnce({
        stdout: Buffer.from(''),
        stderr: Buffer.from('qpdf: invalid password'),
        exitCode: 2,
      });

      // when & then
      await expect(engine.decrypt(dummyPdf)).rejects.toThrow(
        PdfPasswordRequiredException,
      );
    });

    it('손상된 파일에 대해 복호화 시도 시 PdfCorruptedFileException 예외를 던진다', async () => {
      // given
      vi.spyOn(engine, 'runQpdf').mockResolvedValueOnce({
        stdout: Buffer.from(''),
        stderr: Buffer.from("qpdf: can't find pdf header; damaged"),
        exitCode: 2,
      });

      // when & then
      await expect(engine.decrypt(dummyPdf, 'any-pw')).rejects.toThrow(
        PdfCorruptedFileException,
      );
    });
  });

  describe('encrypt', () => {
    it('정상적으로 PDF를 암호화하여 결과 버퍼를 반환한다', async () => {
      // given
      const encryptedBytes = Buffer.from('%PDF-1.4 encrypted content');
      vi.spyOn(engine, 'runQpdf').mockImplementation(async (args) => {
        const outputPath = args[args.length - 1];
        await fs.writeFile(outputPath, encryptedBytes);
        return {
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          exitCode: 0,
        };
      });

      // when
      const result = await engine.encrypt(dummyPdf, 'new-password', 256);

      // then
      expect(result).toEqual(encryptedBytes);
    });
  });
});
