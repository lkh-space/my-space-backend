import { describe, it, expect, beforeEach } from 'vitest';
import { ZipEngine } from './zip.engine.js';

describe('ZipEngine (단위 테스트)', () => {
  let engine: ZipEngine;

  beforeEach(() => {
    engine = new ZipEngine();
  });

  it('분할된 페이지 버퍼들을 ZIP 아카이브 버퍼로 압축한다', async () => {
    // given
    const samplePages = [
      { pageNumber: 1, buffer: Buffer.from('page 1 dummy content') },
      { pageNumber: 2, buffer: Buffer.from('page 2 dummy content') },
    ];

    // when
    const zipBuffer = await engine.compressPages(samplePages, 'split');

    // then
    expect(zipBuffer).toBeInstanceOf(Buffer);
    expect(zipBuffer.length).toBeGreaterThan(0);
    // ZIP 파일 매직 넘버 (PK\x03\x04 -> 0x50, 0x4b, 0x03, 0x04)
    expect(zipBuffer[0]).toBe(0x50);
    expect(zipBuffer[1]).toBe(0x4b);
    expect(zipBuffer[2]).toBe(0x03);
    expect(zipBuffer[3]).toBe(0x04);
  });
});
