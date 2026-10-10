import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface StoredAudioEntry {
  id: string;
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
   * 오디오 버퍼 저장 및 오디오 ID 발급
   * @param ttlSeconds 기본 3600초 (1시간)
   */
  saveAudio(
    buffer: Buffer,
    format = 'wav',
    mimeType = 'audio/wav',
    ttlSeconds = 3600,
  ): string {
    this.cleanExpired();

    const id = `speech-${randomUUID()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    this.store.set(id, {
      id,
      buffer,
      format,
      mimeType,
      createdAt: now,
      expiresAt,
    });

    this.logger.debug(
      `[AudioBufferStore] 오디오 저장 완료: ${id} (${buffer.length} bytes, format: ${format})`,
    );
    return id;
  }

  /**
   * 저장된 오디오 버퍼 조회
   */
  getAudio(id: string): StoredAudioEntry | null {
    const entry = this.store.get(id);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt < new Date()) {
      this.store.delete(id);
      this.logger.debug(`[AudioBufferStore] 만료된 오디오 삭제: ${id}`);
      return null;
    }

    return entry;
  }

  /**
   * 만료된 버퍼 일괄 정리
   */
  private cleanExpired(): void {
    const now = new Date();
    for (const [id, entry] of this.store.entries()) {
      if (entry.expiresAt < now) {
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
}
