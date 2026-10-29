import type { DestinationStream } from 'pino';

/**
 * 로그 레벨별 ANSI 터미널 색상 코드 (로컬 개발 환경 전용)
 * - error / fatal: 빨간색 (Red)
 * - warn: 노란색 (Yellow)
 * - info: 초록색 (Green)
 * - debug: 청록색 (Cyan)
 * - trace: 회색 (Gray)
 */
export const LOG_LEVEL_COLORS: Record<string, string> = {
  fatal: '\x1b[31m',
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[32m',
  debug: '\x1b[36m',
  trace: '\x1b[90m',
};

export const ANSI_RESET = '\x1b[0m';

/**
 * 단일 라인 JSON 로그 문자열을 Winston의 format.prettyPrint()처럼
 * 2칸 들여쓰기(Multi-line)로 변환하고 로그 레벨에 따른 ANSI 색상을 적용합니다.
 */
export function formatPrettyJsonLog(rawChunk: string): string {
  const trimmed = rawChunk.trim();
  if (!trimmed) {
    return rawChunk;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const prettyJson = JSON.stringify(parsed, null, 2);
    const level =
      typeof parsed.level === 'string' ? parsed.level.toLowerCase() : '';
    const colorCode = LOG_LEVEL_COLORS[level];

    if (colorCode) {
      return `${colorCode}${prettyJson}${ANSI_RESET}\n`;
    }
    return `${prettyJson}\n`;
  } catch {
    return rawChunk.endsWith('\n') ? rawChunk : `${rawChunk}\n`;
  }
}

/**
 * 로컬 개발 환경(IS_LOCAL=true)용 인프로세스 Pretty JSON 출력 스트림을 생성합니다.
 * Rspack 단일 번들 환경에서 별도 워커 파일 경로(import.meta.resolve)에 의존하지 않고 동작합니다.
 */
export function createPrettyJsonStream(
  writeFn: (output: string) => void = (output) => {
    process.stdout.write(output);
  },
): DestinationStream {
  return {
    write(chunk: string) {
      writeFn(formatPrettyJsonLog(chunk));
    },
  };
}

export default createPrettyJsonStream;
