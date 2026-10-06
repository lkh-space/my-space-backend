import { HttpStatus } from '@nestjs/common';

/**
 * HTTP 계층 전용 명시적 예외 클래스
 * 컨트롤러, 가드, 미들웨어 등 웹 계층에서 명시적으로 특정 HTTP 상태 코드를 반환해야 할 때 사용합니다.
 */
export class ApiException extends Error {
  constructor(
    public readonly statusCode: HttpStatus,
    message: string,
    public readonly code: string = 'API_ERROR',
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}
