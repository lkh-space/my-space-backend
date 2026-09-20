/**
 * 최상위 도메인 예외 추상 클래스
 * 모든 비즈니스/도메인 계층 예외는 이 클래스를 상속받아야 합니다.
 * 순수 TypeScript Error를 상속하며, NestJS 프레임워크나 전송 계층(HTTP)에 종속되지 않습니다.
 */
export abstract class BaseDomainException extends Error {
  /**
   * HTTP 상태와 독립적인 고유 비즈니스 에러 코드
   * 예: 'USER_NOT_FOUND', 'PDF_PASSWORD_PROTECTED', 'EMAIL_ALREADY_EXISTS'
   */
  abstract readonly code: string;

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}
