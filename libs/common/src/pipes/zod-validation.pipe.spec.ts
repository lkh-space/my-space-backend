import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

class MockUnlockDto {
  static readonly schema = z.object({
    password: z.string().min(1, '비밀번호는 1자 이상이어야 합니다.'),
  });
  password!: string;
}

class MockInspectPdfDto {
  static readonly schema = z.object({
    password: z.string().optional(),
  });
  password?: string;
}

class MockSplitRangePdfDto {
  static readonly schema = z.object({
    ranges: z.string().min(1, '범위는 1자 이상이어야 합니다.'),
  });
  ranges!: string;
}


describe('ZodValidationPipe (BDD 단위 테스트)', () => {
  describe('생성자에 명시적 스키마 주입 방식', () => {
    const testSchema = z.object({
      name: z.string().min(2, '이름은 2자 이상이어야 합니다.'),
      age: z.number().int().positive(),
    });
    const pipe = new ZodValidationPipe(testSchema);

    it('유효한 입력값 전달 시 검증을 통과하고 정제된 데이터를 반환한다', () => {
      // given
      const validPayload = { name: 'Keunhyeok', age: 30, extra: 'dropped' };

      // when
      const result = pipe.transform(validPayload, { type: 'body' });

      // then
      expect(result).toEqual({ name: 'Keunhyeok', age: 30 });
    });

    it('스키마 제약조건 위반 시 BadRequestException을 던진다', () => {
      // given
      const invalidPayload = { name: 'K', age: -5 };

      // when & then
      expect(() => pipe.transform(invalidPayload, { type: 'body' })).toThrow(
        BadRequestException,
      );
    });

    it('예외 객체에 사용자 친화적 메시지와 상세 에러 목록이 포함된다', () => {
      // given
      const invalidPayload = { name: 'K' };

      // when
      try {
        pipe.transform(invalidPayload, { type: 'body' });
        expect.fail('BadRequestException이 발생해야 합니다.');
      } catch (err) {
        // then
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse() as any;
        expect(response.message).toContain(
          '입력값 검증 실패: 이름은 2자 이상이어야 합니다.',
        );
        expect(response.details?.errors).toBeInstanceOf(Array);
        expect(response.details.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('메타타입(static schema) 기반 자동 검증 방식 (Global Pipe)', () => {
    const globalPipe = new ZodValidationPipe();

    it('MockUnlockDto의 static schema를 감지하여 유효한 비밀번호를 정상 통과시킨다', () => {
      // given
      const payload = { password: 'my-secret-password' };

      // when
      const result = globalPipe.transform(payload, {
        type: 'body',
        metatype: MockUnlockDto,
      });

      // then
      expect(result).toEqual({ password: 'my-secret-password' });
    });

    it('MockUnlockDto에 비밀번호가 누락되거나 빈 문자열이면 BadRequestException을 던진다', () => {
      // given
      const emptyPayload = { password: '' };

      // when & then
      expect(() =>
        globalPipe.transform(emptyPayload, {
          type: 'body',
          metatype: MockUnlockDto,
        }),
      ).toThrow(BadRequestException);
    });

    it('MockInspectPdfDto의 password가 없어도 선택적이므로 정상 통과한다', () => {
      // given
      const emptyPayload = {};

      // when
      const result = globalPipe.transform(emptyPayload, {
        type: 'body',
        metatype: MockInspectPdfDto,
      });

      // then
      expect(result).toEqual({});
    });

    it('MockSplitRangePdfDto의 ranges가 누락되면 BadRequestException을 던진다', () => {
      // given
      const invalidPayload = { ranges: '' };

      // when & then
      expect(() =>
        globalPipe.transform(invalidPayload, {
          type: 'body',
          metatype: MockSplitRangePdfDto,
        }),
      ).toThrow(BadRequestException);
    });

    it('스키마가 정의되지 않은 일반 메타타입은 검증 없이 그대로 통과(Bypass)한다', () => {
      // given
      class PlainDto {
        name!: string;
      }
      const rawData = { name: 'raw-data' };

      // when
      const result = globalPipe.transform(rawData, {
        type: 'body',
        metatype: PlainDto,
      });

      // then
      expect(result).toBe(rawData);
    });
  });
});
