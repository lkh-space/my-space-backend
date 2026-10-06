import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QpdfEngine } from './qpdf.engine.js';
import {
  PdfCorruptedFileException,
  PdfInvalidPasswordException,
  PdfPasswordRequiredException,
} from '../exceptions/pdf.exception.js';
import * as nodeQpdf from 'node-qpdf2';

vi.mock('node-qpdf2');

describe('QpdfEngine (단위 테스트)', () => {
  let engine: QpdfEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new QpdfEngine();
  });

  const dummyPdf = Buffer.from('%PDF-1.4 dummy content');

  it('암호화되지 않은 PDF의 경우 isEncrypted=false를 반환한다', async () => {
    // given
    vi.mocked(nodeQpdf.info).mockResolvedValueOnce('File is not encrypted');

    // when
    const status = await engine.checkEncryption(dummyPdf);

    // then
    expect(status.isEncrypted).toBe(false);
    expect(status.isPasswordValid).toBeUndefined();
  });

  it('암호화된 PDF에서 비밀번호가 일치하면 isPasswordValid=true를 반환한다', async () => {
    // given
    vi.mocked(nodeQpdf.info).mockResolvedValueOnce('R = 6 (AES-256)');
    vi.mocked(nodeQpdf.decrypt).mockResolvedValueOnce(
      Buffer.from('decrypted bytes'),
    );

    // when
    const status = await engine.checkEncryption(dummyPdf, 'correct-password');

    // then
    expect(status.isEncrypted).toBe(true);
    expect(status.isPasswordValid).toBe(true);
  });

  it('암호화된 PDF에서 비밀번호가 일치하지 않으면 isPasswordValid=false를 반환한다', async () => {
    // given
    vi.mocked(nodeQpdf.info).mockResolvedValueOnce('R = 6 (AES-256)');
    vi.mocked(nodeQpdf.decrypt).mockRejectedValueOnce(
      new Error('invalid password'),
    );

    // when
    const status = await engine.checkEncryption(dummyPdf, 'wrong-password');

    // then
    expect(status.isEncrypted).toBe(true);
    expect(status.isPasswordValid).toBe(false);
  });

  it('올바른 비밀번호로 복호화 요청 시 복호화된 버퍼를 반환한다', async () => {
    // given
    const expectedBuffer = Buffer.from('clean decrypted pdf');
    vi.mocked(nodeQpdf.decrypt).mockResolvedValueOnce(expectedBuffer);

    // when
    const result = await engine.decrypt(dummyPdf, 'correct-pw');

    // then
    expect(result).toEqual(expectedBuffer);
  });

  it('비밀번호가 틀렸을 때 PdfInvalidPasswordException 예외를 던진다', async () => {
    // given
    vi.mocked(nodeQpdf.decrypt).mockRejectedValueOnce(
      new Error('qpdf: invalid password'),
    );

    // when & then
    await expect(engine.decrypt(dummyPdf, 'wrong-pw')).rejects.toThrow(
      PdfInvalidPasswordException,
    );
  });

  it('암호화된 파일에 비밀번호를 제공하지 않았을 때 PdfPasswordRequiredException 예외를 던진다', async () => {
    // given
    vi.mocked(nodeQpdf.decrypt).mockRejectedValueOnce(
      new Error('qpdf: password required'),
    );

    // when & then
    await expect(engine.decrypt(dummyPdf)).rejects.toThrow(
      PdfPasswordRequiredException,
    );
  });

  it('손상된 파일에 대해 복호화 시도 시 PdfCorruptedFileException 예외를 던진다', async () => {
    // given
    vi.mocked(nodeQpdf.decrypt).mockRejectedValueOnce(
      new Error('qpdf: not a PDF file'),
    );

    // when & then
    await expect(engine.decrypt(dummyPdf, 'pw')).rejects.toThrow(
      PdfCorruptedFileException,
    );
  });
});
