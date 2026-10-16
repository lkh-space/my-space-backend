import { describe, it, expect } from 'vitest';
import { generateDeterministicChunkId } from './uuid-v5.js';

describe('generateDeterministicChunkId (RFC 4122 v5 결정적 UUID 생성기)', () => {
  it('동일한 documentId와 chunkIndex에 대해 언제나 동일한 UUID를 반환해야 한다 (결정성 및 멱등성)', () => {
    // given
    const docId = 'doc-test-123';
    const chunkIndex = 0;

    // when
    const id1 = generateDeterministicChunkId(docId, chunkIndex);
    const id2 = generateDeterministicChunkId(docId, chunkIndex);

    // then
    expect(id1).toBe(id2);
  });

  it('다른 chunkIndex에 대해서는 서로 다른 UUID를 생성해야 한다', () => {
    // given
    const docId = 'doc-test-123';

    // when
    const id0 = generateDeterministicChunkId(docId, 0);
    const id1 = generateDeterministicChunkId(docId, 1);

    // then
    expect(id0).not.toBe(id1);
  });

  it('생성된 문자열은 유효한 UUID v5 표준 포맷이어야 한다', () => {
    // given
    const docId = 'test-doc-id';
    const uuidV5Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // when
    const id = generateDeterministicChunkId(docId, 5);

    // then
    expect(id).toMatch(uuidV5Regex);
  });
});
