import { BaseDomainException } from '../exceptions/domain.exception.js';

/**
 * 프론트매터 파싱 중 보안상 허용되지 않는 스크립트 엔진(JS, CoffeeScript 등)이나
 * 안전하지 않은 구문이 감지되었을 때 발생하는 도메인 예외
 */
export class UnsafeFrontmatterException extends BaseDomainException {
  readonly code = 'MARKDOWN_UNSAFE_FRONTMATTER';

  constructor(
    message = '허용되지 않거나 안전하지 않은 프론트매터 구문 또는 스크립트 엔진입니다.',
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}
