import { describe, it, expect } from 'vitest';
import { createLoggerConfig, checkIsLocal } from './logger.config.js';

describe('logger.config (BDD 단위 테스트)', () => {
  describe('formatters.level', () => {
    it('숫자 대신 문자열 형태의 level 객체를 반환한다', () => {
      // given
      const config = createLoggerConfig({ isLocal: true });
      const formatters = (config as any).pinoHttp.formatters;

      // when
      const infoLevel = formatters.level('info', 30);
      const errorLevel = formatters.level('error', 50);
      const warnLevel = formatters.level('warn', 40);
      const debugLevel = formatters.level('debug', 20);

      // then
      expect(infoLevel).toEqual({ level: 'info' });
      expect(errorLevel).toEqual({ level: 'error' });
      expect(warnLevel).toEqual({ level: 'warn' });
      expect(debugLevel).toEqual({ level: 'debug' });
    });
  });

  describe('checkIsLocal', () => {
    it('명시적 isLocal 값이 전달된 경우 환경변수보다 우선한다', () => {
      // given & when & then
      expect(checkIsLocal(true)).toBe(true);
      expect(checkIsLocal(false)).toBe(false);
    });
  });

  describe('sanitizeRequestId', () => {
    it('유효한 x-request-id 형식(영문, 숫자, 하이픈, 언더스코어, 64자 이내)은 그대로 반환한다', async () => {
      // given
      const { sanitizeRequestId } = await import('./logger.config.js');
      const validId = 'req-123_abc-456';

      // when
      const result = sanitizeRequestId(validId);

      // then
      expect(result).toBe(validId);
    });

    it('배열로 전달된 경우 첫 번째 요소를 검증하여 반환한다', async () => {
      // given
      const { sanitizeRequestId } = await import('./logger.config.js');
      const validArray = ['first-id', 'second-id'];

      // when
      const result = sanitizeRequestId(validArray);

      // then
      expect(result).toBe('first-id');
    });

    it('개행 문자(\\r\\n)나 특수문자가 포함된 경우 새 UUID를 생성하여 로그 주입을 방지한다', async () => {
      // given
      const { sanitizeRequestId } = await import('./logger.config.js');
      const maliciousId = 'req-id\r\n[CRITICAL] Injected Fake Log';

      // when
      const result = sanitizeRequestId(maliciousId);

      // then
      expect(result).not.toContain('\r');
      expect(result).not.toContain('\n');
      expect(result).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('64자를 초과하는 비정상적으로 긴 ID는 새 UUID로 교체한다', async () => {
      // given
      const { sanitizeRequestId } = await import('./logger.config.js');
      const tooLongId = 'a'.repeat(65);

      // when
      const result = sanitizeRequestId(tooLongId);

      // then
      expect(result).not.toBe(tooLongId);
      expect(result).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('헤더가 누락(undefined)된 경우 새 UUID를 생성한다', async () => {
      // given
      const { sanitizeRequestId } = await import('./logger.config.js');

      // when
      const result = sanitizeRequestId(undefined);

      // then
      expect(result).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });
});
