import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  NeuralSessionStatus,
  NeuralStreamSessionDto,
  CreateNeuralSessionDto,
} from './dto/neural-session.dto.js';
import { SessionNotFoundException } from '../voice/exceptions/voice.exception.js';

export interface NeuralSessionEntity {
  id: string;
  ownerId: string;
  title: string;
  status: NeuralSessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class NeuralSessionService {
  private readonly logger = new Logger(NeuralSessionService.name);
  private readonly sessions = new Map<string, NeuralSessionEntity>();

  /**
   * 신규 신경망 스트림 세션 생성
   */
  async createSession(
    ownerId: string,
    dto?: CreateNeuralSessionDto,
  ): Promise<NeuralStreamSessionDto> {
    const id = `session-${randomUUID()}`;
    const now = new Date();
    const title = dto?.title?.trim() || `Neural Stream ${now.toISOString().slice(11, 19)}`;

    const entity: NeuralSessionEntity = {
      id,
      ownerId,
      title,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(id, entity);
    this.logger.log(`[NeuralSession] 신규 세션 생성: ${id} (소유자: ${ownerId})`);

    return this.toDto(entity);
  }

  /**
   * 사용자의 신경망 스트림 세션 목록 조회
   */
  async listSessions(ownerId: string): Promise<NeuralStreamSessionDto[]> {
    const userSessions = Array.from(this.sessions.values())
      .filter((s) => s.ownerId === ownerId)
      .reverse()
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return userSessions.map((s) => this.toDto(s));
  }

  /**
   * 특정 세션 엔티티 조회 (소유권 검증)
   */
  async getSession(ownerId: string, sessionId: string): Promise<NeuralSessionEntity> {
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) {
      throw new SessionNotFoundException(sessionId);
    }
    return session;
  }

  /**
   * 세션 상태 갱신 (내부 파이프라인에서 호출)
   */
  async updateSessionStatus(
    sessionId: string,
    status: NeuralSessionStatus,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.updatedAt = new Date();
    }
  }

  /**
   * 세션 삭제
   */
  async deleteSession(ownerId: string, sessionId: string): Promise<void> {
    const session = await this.getSession(ownerId, sessionId);
    this.sessions.delete(session.id);
  }

  /**
   * DTO 변환 헬퍼
   */
  private toDto(entity: NeuralSessionEntity): NeuralStreamSessionDto {
    return {
      id: entity.id,
      title: entity.title,
      status: entity.status,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
