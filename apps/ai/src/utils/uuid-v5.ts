import { createHash } from 'node:crypto';

/**
 * 마크다운 청크 결정적 UUID 생성을 위한 고정 네임스페이스 UUID
 */
export const DOCUMENT_CHUNK_NAMESPACE = '6f1c4a20-4e3a-4c28-98bb-e30018f3a382';

/**
 * RFC 4122 v5 표준(SHA-1 기반) 결정적 UUID 생성 함수
 * 동일한 (documentId, chunkIndex) 쌍에 대해 언제나 동일한 UUID를 반환하여
 * 재시도 및 중복 메시지 수신 시 Qdrant 포인트 덮어쓰기(멱등성)를 보장합니다.
 */
export function generateDeterministicChunkId(
  documentId: string,
  chunkIndex: number,
  namespace: string = DOCUMENT_CHUNK_NAMESPACE,
): string {
  const name = `${documentId}:${chunkIndex}`;
  const nsClean = namespace.replace(/-/g, '');
  const nsBuffer = Buffer.from(nsClean, 'hex');
  const nameBuffer = Buffer.from(name, 'utf-8');

  const hash = createHash('sha1').update(nsBuffer).update(nameBuffer).digest();

  // RFC 4122 v5: 6번째 바이트 상위 4비트를 0101(5)로 설정
  hash[6] = (hash[6] & 0x0f) | 0x50;
  // RFC 4122 variant: 8번째 바이트 상위 2비트를 10으로 설정
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
