import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import {
  PdfCorruptedFileException,
  PdfPasswordRequiredException,
} from '../exceptions/pdf.exception.js';

export interface PdfMetadata {
  pageCount: number;
  title?: string;
  author?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
}

export interface SplitPageResult {
  pageNumber: number;
  buffer: Buffer;
}

@Injectable()
export class PdflibEngine {
  /**
   * PDF 바이트 버퍼를 로드하여 PDFDocument 인스턴스를 반환합니다.
   */
  private async loadDocument(buffer: Buffer): Promise<PDFDocument> {
    try {
      return await PDFDocument.load(buffer, { ignoreEncryption: false });
    } catch (err: unknown) {
      const msg = String(err).toLowerCase();
      if (msg.includes('encrypted')) {
        throw new PdfPasswordRequiredException('암호화된 PDF 파일입니다.');
      }
      throw new PdfCorruptedFileException(
        '손상되었거나 유효하지 않은 PDF 문서입니다.',
      );
    }
  }

  /**
   * PDF 문서의 페이지 수와 메타데이터를 추출합니다.
   */
  async getMetadata(buffer: Buffer): Promise<PdfMetadata> {
    const doc = await this.loadDocument(buffer);
    return {
      pageCount: doc.getPageCount(),
      title: doc.getTitle() ?? undefined,
      author: doc.getAuthor() ?? undefined,
      creator: doc.getCreator() ?? undefined,
      producer: doc.getProducer() ?? undefined,
      creationDate: doc.getCreationDate() ?? undefined,
      modificationDate: doc.getModificationDate() ?? undefined,
    };
  }

  /**
   * 2개 이상의 PDF 문서를 순차적으로 결합하여 단일 PDF 버퍼를 반환합니다.
   */
  async merge(buffers: Buffer[]): Promise<Buffer> {
    const mergedDoc = await PDFDocument.create();

    for (const buf of buffers) {
      const srcDoc = await this.loadDocument(buf);
      const copiedPages = await mergedDoc.copyPages(
        srcDoc,
        srcDoc.getPageIndices(),
      );
      for (const page of copiedPages) {
        mergedDoc.addPage(page);
      }
    }

    const mergedBytes = await mergedDoc.save();
    return Buffer.from(mergedBytes);
  }

  /**
   * 단일 PDF 문서에서 1-based 페이지 번호 목록을 추출하여 새로운 PDF 버퍼로 반환합니다.
   */
  async extractRanges(buffer: Buffer, pageNumbers: number[]): Promise<Buffer> {
    const srcDoc = await this.loadDocument(buffer);
    const totalPages = srcDoc.getPageCount();

    const newDoc = await PDFDocument.create();
    const pageIndices = pageNumbers.map((p) => p - 1);

    for (const idx of pageIndices) {
      if (idx < 0 || idx >= totalPages) {
        throw new PdfCorruptedFileException(
          `페이지 인덱스(${idx + 1})가 범위를 벗어났습니다.`,
        );
      }
    }

    const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
    for (const page of copiedPages) {
      newDoc.addPage(page);
    }

    const savedBytes = await newDoc.save();
    return Buffer.from(savedBytes);
  }

  /**
   * 단일 PDF의 모든 페이지를 1페이지짜리 개별 PDF 버퍼들의 배열로 분할합니다.
   */
  async splitToSinglePages(buffer: Buffer): Promise<SplitPageResult[]> {
    const srcDoc = await this.loadDocument(buffer);
    const totalPages = srcDoc.getPageCount();
    const results: SplitPageResult[] = [];

    for (let i = 0; i < totalPages; i++) {
      const singleDoc = await PDFDocument.create();
      const [copiedPage] = await singleDoc.copyPages(srcDoc, [i]);
      singleDoc.addPage(copiedPage);

      const savedBytes = await singleDoc.save();
      results.push({
        pageNumber: i + 1,
        buffer: Buffer.from(savedBytes),
      });
    }

    return results;
  }
}
