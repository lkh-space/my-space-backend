import { SetMetadata, CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 전역 Fail-Closed 인증 체계에서 특정 컨트롤러 또는 라우트 핸들러를
 * 비인증 공개 엔드포인트로 명시적으로 허용하기 위한 데코레이터
 */
export const Public = (): CustomDecorator<string> =>
  SetMetadata(IS_PUBLIC_KEY, true);
