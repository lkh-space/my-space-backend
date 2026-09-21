import { Injectable } from '@nestjs/common';
import {
  decrypt as qpdfDecrypt,
  encrypt as qpdfEncrypt,
  info as qpdfInfo,
} from 'node-qpdf2';
import { PDFDocument } from 'pdf-lib';
import { withTempFile, withTempOutputFile } from '../utils/temp-file.util.js';
import {
  PdfCorruptedFileException,
  PdfInvalidPasswordException,
  PdfPasswordRequiredException,
} from '../exceptions/pdf.exception.js';

export interface PdfEncryptionStatus {
  isEncrypted: boolean;
  isPasswordValid?: boolean;
  rawInfo: string;
}

@Injectable()
export class QpdfEngine {
  /**
   * PDF 파일의 암호화 여부 및 비밀번호 유효성을 검사합니다.
   */
  async checkEncryption(
    buffer: Buffer,
    password?: string,
  ): Promise<PdfEncryptionStatus> {
    return withTempFile(buffer, async (tempPath) => {
      let rawInfo = '';
      try {
        rawInfo = await qpdfInfo({ input: tempPath, password });
      } catch (err: unknown) {
        const errorMsg = String(err).toLowerCase();
        // 호스트 환경에 qpdf 바이너리가 없는 경우 (ENOENT) -> pdf-lib 기반 폴백 감지
        if (
          (err as { code?: string })?.code === 'ENOENT' ||
          errorMsg.includes('enoent') ||
          errorMsg.includes('not found')
        ) {
          return this.fallbackCheckEncryption(buffer);
        }

        if (
          errorMsg.includes('invalid password') ||
          errorMsg.includes('incorrect password')
        ) {
          return {
            isEncrypted: true,
            isPasswordValid: false,
            rawInfo: errorMsg,
          };
        }
        if (
          errorMsg.includes('not a pdf') ||
          errorMsg.includes('damaged') ||
          errorMsg.includes('corrupted')
        ) {
          throw new PdfCorruptedFileException(
            '손상되었거나 올바르지 않은 PDF 파일입니다.',
          );
        }
        // 암호화된 파일이나 비밀번호를 요구하는 경우
        if (errorMsg.includes('password')) {
          return {
            isEncrypted: true,
            isPasswordValid: false,
            rawInfo: errorMsg,
          };
        }
        throw new PdfCorruptedFileException(
          'PDF 파일 검사 중 오류가 발생했습니다.',
        );
      }

      const isEncrypted = !rawInfo.toLowerCase().includes('not encrypted');

      if (!isEncrypted) {
        return {
          isEncrypted: false,
          rawInfo,
        };
      }

      // 암호화된 파일인 경우 비밀번호 검증 시도
      let isPasswordValid: boolean | undefined = undefined;
      if (password !== undefined) {
        try {
          await qpdfDecrypt({ input: tempPath, password });
          isPasswordValid = true;
        } catch {
          isPasswordValid = false;
        }
      }

      return {
        isEncrypted: true,
        isPasswordValid,
        rawInfo,
      };
    });
  }

  /**
   * 호스트 OS에 qpdf 바이너리가 설치되어 있지 않을 때 pdf-lib을 통한 비암호화 감지 폴백
   */
  private async fallbackCheckEncryption(
    buffer: Buffer,
  ): Promise<PdfEncryptionStatus> {
    try {
      await PDFDocument.load(buffer, { ignoreEncryption: false });
      return {
        isEncrypted: false,
        rawInfo: 'File is not encrypted (fallback via pdf-lib)',
      };
    } catch (err: unknown) {
      const msg = String(err).toLowerCase();
      if (msg.includes('encrypted')) {
        return {
          isEncrypted: true,
          isPasswordValid: false,
          rawInfo: 'File is encrypted (fallback via pdf-lib)',
        };
      }
      throw new PdfCorruptedFileException(
        '손상되었거나 올바르지 않은 PDF 파일입니다.',
      );
    }
  }

  /**
   * 비밀번호로 보호된 PDF를 복호화하여 암호 없는 순수 PDF 버퍼로 반환합니다.
   */
  async decrypt(buffer: Buffer, password?: string): Promise<Buffer> {
    return withTempFile(buffer, async (tempPath) => {
      try {
        const decryptedBuffer = await qpdfDecrypt({
          input: tempPath,
          password,
        });
        return decryptedBuffer;
      } catch (err: unknown) {
        const errorMsg = String(err).toLowerCase();

        if (
          errorMsg.includes('invalid password') ||
          errorMsg.includes('incorrect password')
        ) {
          throw new PdfInvalidPasswordException(
            '제공된 PDF 비밀번호가 일치하지 않습니다.',
          );
        }
        if (
          errorMsg.includes('password required') ||
          (errorMsg.includes('password') && !password)
        ) {
          throw new PdfPasswordRequiredException(
            '암호화된 PDF 파일입니다. 올바른 비밀번호가 필요합니다.',
          );
        }
        if (
          errorMsg.includes('not a pdf') ||
          errorMsg.includes('damaged') ||
          errorMsg.includes('corrupted')
        ) {
          throw new PdfCorruptedFileException(
            '손상되었거나 올바르지 않은 PDF 파일입니다.',
          );
        }

        throw new PdfCorruptedFileException(
          `PDF 복호화 중 오류가 발생했습니다: ${String(err)}`,
        );
      }
    });
  }

  /**
   * 일반 PDF에 비밀번호를 설정하여 암호화된 PDF 버퍼로 반환합니다.
   */
  async encrypt(
    buffer: Buffer,
    password: string,
    keyLength: 128 | 256 = 256,
  ): Promise<Buffer> {
    return withTempFile(buffer, async (tempPath) => {
      return withTempOutputFile(async (outputPath) => {
        try {
          await qpdfEncrypt({
            input: tempPath,
            output: outputPath,
            password,
            keyLength,
          });
        } catch (err: unknown) {
          throw new PdfCorruptedFileException(
            `PDF 암호화 중 오류가 발생했습니다: ${String(err)}`,
          );
        }
      });
    });
  }
}
