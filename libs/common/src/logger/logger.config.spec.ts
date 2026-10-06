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
});
