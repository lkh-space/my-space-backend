import { Injectable, Logger } from '@nestjs/common';

export interface ActiveStreamEntry {
  sessionId: string;
  streamId?: string;
  abortController: AbortController;
  registeredAt: Date;
}

@Injectable()
export class ActiveStreamRegistry {
  private readonly logger = new Logger(ActiveStreamRegistry.name);
  private readonly activeStreams = new Map<string, ActiveStreamEntry>();

  /**
   * 신규 활성 스트림 등록 (세션 ID 기준)
   */
  registerStream(sessionId: string, streamId?: string): AbortController {
    // 기존에 진행 중인 스트림이 있다면 먼저 중단
    const existing = this.activeStreams.get(sessionId);
    if (existing) {
      this.logger.warn(`[StreamRegistry] 세션 ${sessionId}의 이전 활성 스트림을 선제적으로 중단합니다.`);
      try {
        existing.abortController.abort();
      } catch (err) {
        this.logger.error(`[StreamRegistry] 기존 스트림 중단 중 에러: ${err}`);
      }
    }

    const abortController = new AbortController();
    this.activeStreams.set(sessionId, {
      sessionId,
      streamId,
      abortController,
      registeredAt: new Date(),
    });

    this.logger.debug(`[StreamRegistry] 스트림 등록 완료: 세션 ${sessionId}`);
    return abortController;
  }

  /**
   * 특정 세션의 스트림 중단 (Interrupt)
   * @returns 중단된 스트림이 존재하면 true, 없으면 false
   */
  interruptStream(sessionId: string): boolean {
    const entry = this.activeStreams.get(sessionId);
    if (!entry) {
      this.logger.debug(`[StreamRegistry] 중단 대상 활성 스트림 없음: ${sessionId}`);
      return false;
    }

    this.logger.log(`[StreamRegistry] 세션 ${sessionId} 발화 인터럽트(중단) 실행`);
    try {
      entry.abortController.abort();
    } catch (err) {
      this.logger.error(`[StreamRegistry] abort() 실행 중 에러: ${err}`);
    } finally {
      this.activeStreams.delete(sessionId);
    }

    return true;
  }

  /**
   * 스트림 정상 완료 후 레지스트리에서 제거
   */
  unregisterStream(sessionId: string): void {
    this.activeStreams.delete(sessionId);
    this.logger.debug(`[StreamRegistry] 스트림 정상 해제: 세션 ${sessionId}`);
  }

  /**
   * 활성 스트림 수 조회 (모니터링/진단용)
   */
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }
}
