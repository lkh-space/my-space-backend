import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 분산 추적 컨텍스트 인터페이스
 */
export interface TraceContext {
  /** 요청 고유 식별자 (HTTP x-request-id 또는 메시지 큐 correlationId) */
  requestId: string;
  /** 분산 추적 traceId */
  traceId?: string;
  /** 인증된 사용자 식별자 */
  userId?: string;
  /** 추가 커스텀 메타데이터 */
  [key: string]: unknown;
}

/**
 * Node.js AsyncLocalStorage 기반 분산 추적 컨텍스트 서비스
 * HTTP 요청 핸들러, 비동기 Promise 체인, RabbitMQ 메시지 큐 워커 등
 * 모든 비동기 실행 흐름에서 일관된 requestId 및 traceId를 공유하고 전파합니다.
 */
@Injectable()
export class TraceContextService {
  private readonly asyncLocalStorage = new AsyncLocalStorage<TraceContext>();

  /**
   * 지정된 추적 컨텍스트 범위 내에서 콜백 함수를 실행합니다.
   * 비동기 작업(Promise 체인 및 I/O)이 완료될 때까지 동일 컨텍스트가 유지됩니다.
   */
  runWithContext<T>(context: TraceContext, fn: () => T | Promise<T>): T | Promise<T> {
    return this.asyncLocalStorage.run(context, fn);
  }

  /**
   * 현재 비동기 실행 흐름에 활성화된 전체 컨텍스트를 반환합니다.
   */
  getContext(): TraceContext | undefined {
    return this.asyncLocalStorage.getStore();
  }

  /**
   * 현재 요청의 고유 requestId를 반환합니다.
   * 컨텍스트가 활성화되어 있지 않으면 undefined를 반환합니다.
   */
  getRequestId(): string | undefined {
    return this.asyncLocalStorage.getStore()?.requestId;
  }

  /**
   * 현재 요청의 traceId를 반환합니다. (미설정 시 requestId 폴백)
   */
  getTraceId(): string | undefined {
    const store = this.asyncLocalStorage.getStore();
    return store?.traceId || store?.requestId;
  }

  /**
   * 현재 컨텍스트에 추가 필드를 병합/업데이트합니다.
   */
  setContext(partial: Partial<TraceContext>): void {
    const store = this.asyncLocalStorage.getStore();
    if (store) {
      Object.assign(store, partial);
    }
  }
}
