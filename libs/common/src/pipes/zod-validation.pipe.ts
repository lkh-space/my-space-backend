import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  Optional,
  PipeTransform,
} from '@nestjs/common';
import { type ZodTypeAny } from 'zod';

/**
 * Zod 스키마 기반 요청 페이로드 유효성 검증 및 변환 파이프
 *
 * 1. 생성자에 명시적 Zod 스키마가 주입된 경우: 해당 스키마로 검증 수행
 * 2. 전역 파이프(Global Pipe)로 등록된 경우:
 *    핸들러 파라미터 타입(metadata.metatype)의 정적 프로퍼티(static schema)를 읽어 자동으로 유효성 검증 수행
 * 3. 스키마가 없는 경우: 원본 값을 그대로 통과 (Bypass)
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(@Optional() private readonly schema?: ZodTypeAny) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const targetSchema =
      this.schema ||
      (metadata?.metatype &&
        (metadata.metatype as { schema?: ZodTypeAny }).schema);

    // 검증할 Zod 스키마가 정의되어 있지 않은 경우 그대로 통과
    if (!targetSchema) {
      return value;
    }

    const result = targetSchema.safeParse(value);

    if (!result.success) {
      const formattedErrors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));

      const firstMessage =
        formattedErrors[0]?.message || '입력값 유효성 검증에 실패했습니다.';

      throw new BadRequestException({
        message: `입력값 검증 실패: ${firstMessage}`,
        details: {
          errors: formattedErrors,
        },
      });
    }

    return result.data;
  }
}
