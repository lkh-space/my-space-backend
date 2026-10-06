import { Injectable } from '@nestjs/common';
import { ZipArchive } from 'archiver';
import { PassThrough } from 'node:stream';
import type { SplitPageResult } from './pdflib.engine.js';

@Injectable()
export class ZipEngine {
  /**
   * 분할된 페이지 PDF 버퍼 목록을 단일 ZIP 아카이브 버퍼로 압축합니다.
   *
   * @param pages 분할된 페이지 목록 ({ pageNumber, buffer })
   * @param prefix 파일명 접두사 (기본: 'page')
   * @returns ZIP 아카이브 바이너리 버퍼
   */
  async compressPages(
    pages: SplitPageResult[],
    prefix = 'page',
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = new ZipArchive({
        zlib: { level: 6 },
      });

      const passThrough = new PassThrough();
      const chunks: Buffer[] = [];

      passThrough.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });

      passThrough.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      passThrough.on('error', (err) => {
        reject(err);
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(passThrough);

      // 0 채움(Zero-padding)으로 정렬이 깔끔하게 되도록 파일명 포맷팅
      const maxDigits = Math.max(3, String(pages.length).length);

      for (const item of pages) {
        const paddedNum = String(item.pageNumber).padStart(maxDigits, '0');
        const entryName = `${prefix}_${paddedNum}.pdf`;
        archive.append(item.buffer, { name: entryName });
      }

      archive.finalize().catch((err) => reject(err));
    });
  }
}
