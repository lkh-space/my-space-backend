import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
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

export interface QpdfSpawnResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

@Injectable()
export class QpdfEngine {
  private readonly logger = new Logger(QpdfEngine.name);
  static readonly PROCESS_TIMEOUT_MS = 30000;

  /**
   * 네이티브 QPDF 바이너리를 안전하게 실행합니다.
   *
   * 1. stdout/stderr 수집 시 Buffer.concat을 사용하여 바이너리 손상을 방지합니다.
   * 2. 프로세스 인자로 패스워드가 노출되지 않도록 stdin 입력을 지원합니다.
   * 3. DoS 방지를 위한 30초 프로세스 타임아웃을 적용합니다.
   */
  async runQpdf(args: string[], stdinInput?: string): Promise<QpdfSpawnResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('qpdf', args, {
        timeout: QpdfEngine.PROCESS_TIMEOUT_MS,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      child.on('error', (err: NodeJS.ErrnoException) => {
        reject(err);
      });

      child.on('close', (code, signal) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          return reject(
            new Error(
              `QPDF 프로세스가 타임아웃(${QpdfEngine.PROCESS_TIMEOUT_MS}ms)으로 강제 종료되었습니다.`,
            ),
          );
        }
        resolve({
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
          exitCode: code ?? 0,
        });
      });

      if (stdinInput !== undefined) {
        child.stdin.write(stdinInput + '\n');
        child.stdin.end();
      } else {
        child.stdin.end();
      }
    });
  }

  /**
   * PDF 파일의 암호화 여부 및 비밀번호 유효성을 검사합니다.
   */
  async checkEncryption(
    buffer: Buffer,
    password?: string,
  ): Promise<PdfEncryptionStatus> {
    return withTempFile(buffer, async (tempPath) => {
      let result: QpdfSpawnResult;
      try {
        result = await this.runQpdf(['--show-encryption', tempPath]);
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
        throw new PdfCorruptedFileException(
          'PDF 파일 검사 중 시스템 오류가 발생했습니다.',
        );
      }

      const stdoutStr = result.stdout.toString('utf-8');
      const stderrStr = result.stderr.toString('utf-8').toLowerCase();

      // 파일 손상 여부 판별
      if (
        result.exitCode === 2 &&
        (stderrStr.includes('not a pdf') ||
          stderrStr.includes('damaged') ||
          stderrStr.includes('corrupted') ||
          stderrStr.includes("can't find pdf header"))
      ) {
        throw new PdfCorruptedFileException(
          '손상되었거나 올바르지 않은 PDF 파일입니다.',
        );
      }

      const isEncrypted = !stdoutStr.toLowerCase().includes('not encrypted');

      if (!isEncrypted) {
        return {
          isEncrypted: false,
          rawInfo: stdoutStr,
        };
      }

      // 암호화된 파일인 경우 비밀번호 검증 시도
      let isPasswordValid: boolean | undefined = undefined;
      if (password !== undefined) {
        try {
          const checkResult = await this.runQpdf(
            ['--password-file=-', '--check', tempPath],
            password,
          );
          isPasswordValid = checkResult.exitCode === 0;
        } catch {
          isPasswordValid = false;
        }
      }

      return {
        isEncrypted: true,
        isPasswordValid,
        rawInfo: stdoutStr,
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
   * 파일 기반 출력 및 Buffer.concat으로 바이너리 손상을 방지합니다.
   */
  async decrypt(buffer: Buffer, password?: string): Promise<Buffer> {
    return withTempFile(buffer, async (tempPath) => {
      return withTempOutputFile(async (outputPath) => {
        const args = ['--decrypt'];
        if (password) {
          args.push('--password-file=-');
        }
        args.push(tempPath, outputPath);

        let result: QpdfSpawnResult;
        try {
          result = await this.runQpdf(args, password);
        } catch (err: unknown) {
          const errorMsg = String(err).toLowerCase();
          if (
            (err as { code?: string })?.code === 'ENOENT' ||
            errorMsg.includes('enoent')
          ) {
            throw new PdfCorruptedFileException(
              '호스트에 QPDF 바이너리가 설치되어 있지 않습니다.',
            );
          }
          throw new PdfCorruptedFileException(
            `PDF 복호화 중 오류가 발생했습니다: ${String(err)}`,
          );
        }

        if (result.exitCode !== 0) {
          const errorMsg = result.stderr.toString('utf-8').toLowerCase();

          if (
            errorMsg.includes('invalid password') ||
            errorMsg.includes('incorrect password')
          ) {
            if (!password) {
              throw new PdfPasswordRequiredException(
                '암호화된 PDF 파일입니다. 올바른 비밀번호가 필요합니다.',
              );
            }
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
            errorMsg.includes('corrupted') ||
            errorMsg.includes("can't find pdf header")
          ) {
            throw new PdfCorruptedFileException(
              '손상되었거나 올바르지 않은 PDF 파일입니다.',
            );
          }

          throw new PdfCorruptedFileException(
            `PDF 복호화 실패 (exit code ${result.exitCode}): ${result.stderr.toString('utf-8').trim()}`,
          );
        }
      });
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
        const args = ['--encrypt', password, password, String(keyLength)];
        if (keyLength === 128) {
          args.push('--use-aes=y');
        }
        args.push('--', tempPath, outputPath);

        let result: QpdfSpawnResult;
        try {
          result = await this.runQpdf(args);
        } catch (err: unknown) {
          throw new PdfCorruptedFileException(
            `PDF 암호화 중 프로세스 실행 실패: ${String(err)}`,
          );
        }

        if (result.exitCode !== 0) {
          throw new PdfCorruptedFileException(
            `PDF 암호화 실패: ${result.stderr.toString('utf-8').trim()}`,
          );
        }
      });
    });
  }
}
