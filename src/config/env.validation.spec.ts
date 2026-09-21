import { describe, it, expect } from 'vitest';
import { validateEnv } from './env.validation.js';

describe('validateEnv (Zod 환경변수 검증)', () => {
  describe('정상 시나리오 및 기본값 적용', () => {
    it('환경변수가 비어있을 때 정의된 기본값을 올바르게 채워 반환해야 한다', () => {
      // given
      const rawConfig = {};

      // when
      const result = validateEnv(rawConfig);

      // then
      expect(result.PORT).toBe(3000);
      expect(result.NODE_ENV).toBe('development');
      expect(result.IS_LOCAL).toBe(false);
      expect(result.LOG_LEVEL).toBeUndefined();
    });

    it('문자열 형태의 유효한 값들을 지정된 타입으로 변환(Coerce/Transform)해야 한다', () => {
      // given
      const rawConfig = {
        PORT: '4500',
        NODE_ENV: 'production',
        IS_LOCAL: 'true',
        LOG_LEVEL: 'warn',
      };

      // when
      const result = validateEnv(rawConfig);

      // then
      expect(result.PORT).toBe(4500);
      expect(result.NODE_ENV).toBe('production');
      expect(result.IS_LOCAL).toBe(true);
      expect(result.LOG_LEVEL).toBe('warn');
    });

    it('IS_LOCAL이 false이거나 다른 문자열일 경우 false로 처리되어야 한다', () => {
      // given
      const rawConfig = {
        IS_LOCAL: 'false',
      };

      // when
      const result = validateEnv(rawConfig);

      // then
      expect(result.IS_LOCAL).toBe(false);
    });
  });

  describe('유효성 검증 실패 시나리오 (Fail-fast)', () => {
    it('PORT가 숫자가 아닐 경우 에러를 던져야 한다', () => {
      // given
      const rawConfig = {
        PORT: 'not-a-number',
      };

      // when & then
      expect(() => validateEnv(rawConfig)).toThrowError(
        /환경변수 검증 실패.*PORT/,
      );
    });

    it('PORT가 유효 범위(1~65535)를 벗어날 경우 에러를 던져야 한다', () => {
      // given
      const rawConfig = {
        PORT: '70000',
      };

      // when & then
      expect(() => validateEnv(rawConfig)).toThrowError(
        /환경변수 검증 실패.*PORT/,
      );
    });

    it('NODE_ENV에 허용되지 않은 환경값이 주어질 경우 에러를 던져야 한다', () => {
      // given
      const rawConfig = {
        NODE_ENV: 'staging',
      };

      // when & then
      expect(() => validateEnv(rawConfig)).toThrowError(
        /환경변수 검증 실패.*NODE_ENV/,
      );
    });

    it('LOG_LEVEL에 허용되지 않은 레벨이 주어질 경우 에러를 던져야 한다', () => {
      // given
      const rawConfig = {
        LOG_LEVEL: 'verbose',
      };

      // when & then
      expect(() => validateEnv(rawConfig)).toThrowError(
        /환경변수 검증 실패.*LOG_LEVEL/,
      );
    });
  });
});
