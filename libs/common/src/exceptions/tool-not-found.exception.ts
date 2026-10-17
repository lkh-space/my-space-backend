import { BaseDomainException } from './domain.exception.js';

/**
 * 지원하지 않거나 존재하지 않는 AI 도구 이름을 호출했을 때 발생하는 예외
 */
export class ToolNotFoundException extends BaseDomainException {
  readonly code = 'AI_TOOL_NOT_FOUND';

  constructor(toolName: string) {
    super(`지원하지 않는 도구 이름입니다: ${toolName}`, { toolName });
  }
}
