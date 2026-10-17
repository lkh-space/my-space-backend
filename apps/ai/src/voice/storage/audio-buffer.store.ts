import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface StoredAudioEntry {
  id: string;
  ownerId?: string;
  buffer: Buffer;
  format: string;
  mimeType: string;
  createdAt: Date;
  expiresAt: Date;
}

@Injectable()
export class AudioBufferStore {
  private readonly logger = new Logger(AudioBufferStore.name);
  private readonly store = new Map<string, StoredAudioEntry>();

  /**
   * 최대 총 오디오 버퍼 용량 (기본 100MB)
   */
  public readonly maxTotalBytes: number = 100 * 1024 * 1024;
  private currentTotalBytes = 0;

  /**
   * 오디오 버퍼 저장 및 오디오 ID 발급 (소유자 ID 및 LRU 지원)
   */
  saveAudio(
    ownerIdOrBuffer: string | Buffer,
    bufferOrFormat?: Buffer | string,
    formatOrMimeType = 'wav',
    mimeTypeOrTtl: string | number = 'audio/wav',
    ttlSeconds = 3600,
  ): string {
    this.cleanExpired();

    let ownerId: string | undefined;
    let buffer: Buffer;
    let format = 'wav';
    let mimeType = 'audio/wav';
    let ttl = ttlSeconds;

    if (typeof ownerIdOrBuffer === 'string' && Buffer.isBuffer(bufferOrFormat)) {
      ownerId = ownerIdOrBuffer;
      buffer = bufferOrFormat;
      format = typeof formatOrMimeType === 'string' ? formatOrMimeType : 'wav';
      mimeType = typeof mimeTypeOrTtl === 'string' ? mimeTypeOrTtl : 'audio/wav';
    } else if (Buffer.isBuffer(ownerIdOrBuffer)) {
      buffer = ownerIdOrBuffer;
      format = typeof bufferOrFormat === 'string' ? bufferOrFormat : 'wav';
      mimeType = typeof formatOrMimeType === 'string' ? formatOrMimeType : 'audio/wav';
      ttl = typeof mimeTypeOrTtl === 'number' ? mimeTypeOrTtl : 3600;
    } else {
      throw new Error('유효하지 않은 오디오 버퍼입니다.');
    }

    // LRU 기반 공간 확보: 100MB 상한 초과 시 가장 오래된 항목부터 폐기
    while (
      this.store.size > 0 &&
      this.currentTotalBytes + buffer.length > this.maxTotalBytes
    ) {
      const oldestId = this.store.keys().next().value;
      if (!oldestId) break;
      const evicted = this.store.get(oldestId);
      if (evicted) {
        this.currentTotalBytes -= evicted.buffer.length;
      }
      this.store.delete(oldestId);
      this.logger.warn(
        `[AudioBufferStore] LRU 메모리 공간 확보를 위해 오래된 오디오 폐기: ${oldestId}`,
      );
    }

    const id = `speech-${randomUUID()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    this.store.set(id, {
      id,
      ownerId,
      buffer,
      format,
      mimeType,
      createdAt: now,
      expiresAt,
    });
    this.currentTotalBytes += buffer.length;

    this.logger.debug(
      `[AudioBufferStore] 오디오 저장 완료: ${id} (owner: ${ownerId || 'anonymous'}, ${buffer.length} bytes, format: ${format})`,
    );
    return id;
  }

  /**
   * 저장된 오디오 버퍼 조회 (소유권 검증 및 LRU 갱신)
   */
  getAudio(id: string, ownerId?: string): StoredAudioEntry | null {
    const entry = this.store.get(id);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt < new Date()) {
      this.currentTotalBytes -= entry.buffer.length;
      this.store.delete(id);
      this.logger.debug(`[AudioBufferStore] 만료된 오디오 삭제: ${id}`);
      return null;
    }

    // 소유권 검증: ownerId가 지정되어 있고 엔트리의 소유자와 불일치 시 접근 거부
    if (ownerId && entry.ownerId && entry.ownerId !== ownerId) {
      this.logger.warn(
        `[AudioBufferStore] 오디오 접근 소유권 불일치: ${id} (요청자: ${ownerId}, 소유자: ${entry.ownerId})`,
      );
      return null;
    }

    // LRU 갱신: 최근 참조된 항목을 Map의 맨 뒤로 이동
    this.store.delete(id);
    this.store.set(id, entry);

    return entry;
  }

  /**
   * 만료된 버퍼 일괄 정리
   */
  private cleanExpired(): void {
    const now = new Date();
    for (const [id, entry] of this.store.entries()) {
      if (entry.expiresAt < now) {
        this.currentTotalBytes -= entry.buffer.length;
        this.store.delete(id);
      }
    }
  }

  /**
   * 현재 캐시된 오디오 수 (진단용)
   */
  getAudioCount(): number {
    return this.store.size;
  }

  /**
   * 현재 캐시된 총 오디오 바이트 수 (진단용)
   */
  getCurrentTotalBytes(): number {
    return this.currentTotalBytes;
  }
}
