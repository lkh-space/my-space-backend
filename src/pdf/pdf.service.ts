import { Injectable } from '@nestjs/common';
import { QpdfEngine } from './engines/qpdf.engine.js';
import { PdflibEngine } from './engines/pdflib.engine.js';
import { ZipEngine } from './engines/zip.engine.js';
import { parsePageRanges } from './utils/page-range.parser.js';
import {
  PdfFileCountException,
  PdfNotProtectedException,
  PdfPasswordRequiredException,
} from './exceptions/pdf.exception.js';
import type { InspectPdfResponseDto } from './dto/inspect-pdf.dto.js';

export interface MergeFileInput {
  buffer: Buffer;
  password?: string;
}

@Injectable()
export class PdfService {
  constructor(
    private readonly qpdfEngine: QpdfEngine,
    private readonly pdflibEngine: PdflibEngine,
    private readonly zipEngine: ZipEngine,
  ) {}

  /**
   * PDF 파일의 암호화 여부, 비밀번호 일치 검증, 페이지 수 및 메타데이터를 검사합니다.
   */
  async inspect(
    buffer: Buffer,
    password?: string,
  ): Promise<InspectPdfResponseDto> {
    const encStatus = await this.qpdfEngine.checkEncryption(buffer, password);

    if (!encStatus.isEncrypted) {
      const meta = await this.pdflibEngine.getMetadata(buffer);
      return {
        isEncrypted: false,
        isPasswordValid: undefined,
        pageCount: meta.pageCount,
        metadata: {
          title: meta.title,
          author: meta.author,
          creator: meta.creator,
          producer: meta.producer,
          creationDate: meta.creationDate,
          modificationDate: meta.modificationDate,
        },
      };
    }

    // 암호화된 파일인 경우
    if (encStatus.isPasswordValid === true && password) {
      const decrypted = await this.qpdfEngine.decrypt(buffer, password);
      const meta = await this.pdflibEngine.getMetadata(decrypted);
      return {
        isEncrypted: true,
        isPasswordValid: true,
        pageCount: meta.pageCount,
        metadata: {
          title: meta.title,
          author: meta.author,
          creator: meta.creator,
          producer: meta.producer,
          creationDate: meta.creationDate,
          modificationDate: meta.modificationDate,
        },
      };
    }

    return {
      isEncrypted: true,
      isPasswordValid: encStatus.isPasswordValid,
    };
  }

  /**
   * 비밀번호로 보호된 PDF의 암호를 영구 제거한 클린 PDF를 반환합니다.
   */
  async unlock(buffer: Buffer, password: string): Promise<Buffer> {
    if (!password || password.trim() === '') {
      throw new PdfPasswordRequiredException(
        '암호를 해제하기 위한 비밀번호가 필요합니다.',
      );
    }

    const status = await this.qpdfEngine.checkEncryption(buffer);
    if (!status.isEncrypted) {
      throw new PdfNotProtectedException(
        '해당 PDF 파일은 암호로 보호되어 있지 않습니다.',
      );
    }

    return this.qpdfEngine.decrypt(buffer, password);
  }

  /**
   * 2개 이상의 PDF(암호화된 PDF 포함 시 비밀번호 인증 후)를 순차적으로 병합합니다.
   */
  async merge(files: MergeFileInput[]): Promise<Buffer> {
    if (files.length < 2) {
      throw new PdfFileCountException('MIN', files.length);
    }
    if (files.length > 20) {
      throw new PdfFileCountException('MAX', files.length);
    }

    const preparedBuffers: Buffer[] = [];

    for (const item of files) {
      const status = await this.qpdfEngine.checkEncryption(
        item.buffer,
        item.password,
      );
      if (status.isEncrypted) {
        if (!item.password) {
          throw new PdfPasswordRequiredException(
            '병합 대상 파일 중 암호화된 PDF가 포함되어 있습니다. 비밀번호를 입력해주세요.',
          );
        }
        const decrypted = await this.qpdfEngine.decrypt(
          item.buffer,
          item.password,
        );
        preparedBuffers.push(decrypted);
      } else {
        preparedBuffers.push(item.buffer);
      }
    }

    return this.pdflibEngine.merge(preparedBuffers);
  }

  /**
   * 단일 PDF에서 지정한 페이지 범위를 추출하여 단일 PDF로 결합 반환합니다.
   */
  async splitRange(
    buffer: Buffer,
    ranges: string,
    password?: string,
  ): Promise<Buffer> {
    let workingBuffer = buffer;

    const status = await this.qpdfEngine.checkEncryption(buffer, password);
    if (status.isEncrypted) {
      if (!password) {
        throw new PdfPasswordRequiredException(
          '암호화된 PDF 파일입니다. 비밀번호를 입력해주세요.',
        );
      }
      workingBuffer = await this.qpdfEngine.decrypt(buffer, password);
    }

    const meta = await this.pdflibEngine.getMetadata(workingBuffer);
    const targetPages = parsePageRanges(ranges, meta.pageCount);

    return this.pdflibEngine.extractRanges(workingBuffer, targetPages);
  }

  /**
   * 단일 PDF의 모든 페이지를 낱장 PDF로 분할한 뒤 단일 ZIP 아카이브로 압축하여 반환합니다.
   */
  async splitAll(buffer: Buffer, password?: string): Promise<Buffer> {
    let workingBuffer = buffer;

    const status = await this.qpdfEngine.checkEncryption(buffer, password);
    if (status.isEncrypted) {
      if (!password) {
        throw new PdfPasswordRequiredException(
          '암호화된 PDF 파일입니다. 비밀번호를 입력해주세요.',
        );
      }
      workingBuffer = await this.qpdfEngine.decrypt(buffer, password);
    }

    const singlePages =
      await this.pdflibEngine.splitToSinglePages(workingBuffer);
    return this.zipEngine.compressPages(singlePages, 'page');
  }
}
