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

  describe('로컬 멀티라인 들여쓰기 및 로그 레벨별 색상 포맷팅 (Pretty JSON Stream)', () => {
    it('isLocal: true일 때는 커스텀 stream이 설정되고, isLocal: false(운영)일 때는 단일 라인 출력을 위해 stream이 undefined여야 한다', () => {
      // given & when
      const localConfig = createLoggerConfig({ isLocal: true }) as any;
      const prodConfig = createLoggerConfig({ isLocal: false }) as any;

      // then
      expect(localConfig.pinoHttp.stream).toBeDefined();
      expect(typeof localConfig.pinoHttp.stream.write).toBe('function');
      expect(prodConfig.pinoHttp.stream).toBeUndefined();
    });

    it('단일 라인 JSON을 2칸 들여쓰기(Multi-line)로 변환하고 error 레벨은 빨간색, info 레벨은 초록색 ANSI 코드를 적용해야 한다', async () => {
      // given
      const {
        formatPrettyJsonLog,
        LOG_LEVEL_COLORS,
        ANSI_RESET,
      } = await import('./pretty-json.transport.js');
      const errorLine = JSON.stringify({
        level: 'error',
        msg: 'Something failed',
      });
      const infoLine = JSON.stringify({
        level: 'info',
        msg: 'Server started',
      });

      // when
      const formattedError = formatPrettyJsonLog(errorLine);
      const formattedInfo = formatPrettyJsonLog(infoLine);

      // then
      expect(formattedError).toContain('{\n  "level": "error",\n  "msg": "Something failed"\n}');
      expect(formattedError.startsWith(LOG_LEVEL_COLORS.error)).toBe(true);
      expect(formattedError.endsWith(`${ANSI_RESET}\n`)).toBe(true);

      expect(formattedInfo).toContain('{\n  "level": "info",\n  "msg": "Server started"\n}');
      expect(formattedInfo.startsWith(LOG_LEVEL_COLORS.info)).toBe(true);
      expect(formattedInfo.endsWith(`${ANSI_RESET}\n`)).toBe(true);
    });

    it('운영 환경(isLocal: false)에서는 색상 코드(\\x1b[)나 멀티라인 줄바꿈이 전혀 없는 순수 1줄 JSON만 출력되어야 한다', async () => {
      // given
      const pinoModule = await import('pino');
      const pino = pinoModule.default;
      const prodConfig = createLoggerConfig({ isLocal: false }) as any;
      const capturedLogs: string[] = [];

      const logger = pino(
        {
          level: prodConfig.pinoHttp.level,
          timestamp: prodConfig.pinoHttp.timestamp,
          formatters: prodConfig.pinoHttp.formatters,
        },
        prodConfig.pinoHttp.stream ?? {
          write(chunk: string) {
            capturedLogs.push(chunk);
          },
        },
      );

      // when
      logger.error('Production error message');

      // then
      expect(capturedLogs).toHaveLength(1);
      const rawOutput = capturedLogs[0];
      expect(rawOutput).not.toContain('\x1b[');
      expect(rawOutput.trim().split('\n')).toHaveLength(1);
      expect(() => JSON.parse(rawOutput)).not.toThrow();
    });
  });
});
