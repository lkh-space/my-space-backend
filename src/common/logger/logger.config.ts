import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import pino from 'pino';

/**
 * 로거 설정 옵션 인터페이스
 */
export interface LoggerConfigOptions {
  isLocal?: boolean;
  logLevel?: string;
}

/**
 * 로컬 환경 여부 확인:
 * 명시적 isLocal 값이 전달된 경우 우선 적용하며,
 * 미전달 시 IS_LOCAL 환경변수를 기준으로 판단합니다.
 */
export function checkIsLocal(isLocalExplicit?: boolean): boolean {
  if (typeof isLocalExplicit === 'boolean') {
    return isLocalExplicit;
  }
  return process.env.IS_LOCAL === 'true';
}

/**
 * 로컬 들여쓰기 JSON 트랜스포트 설정:
 * 로컬 환경(isLocal === true)일 때만 적용하며,
 * Winston의 format.prettyPrint()처럼 2칸 들여쓰기된 JSON 포맷을 터미널에 출력합니다.
 */
function getPrettyTransport(isLocal: boolean) {
  if (!isLocal) {
    return undefined;
  }

  try {
    const target = import.meta.resolve('./pretty-json.transport.js');
    return {
      target,
    };
  } catch {
    return undefined;
  }
}

/**
 * Pino 로거 설정 생성 함수
 */
export function createLoggerConfig(options?: LoggerConfigOptions): Params {
  const isLocal = checkIsLocal(options?.isLocal);
  const logLevel =
    options?.logLevel || process.env.LOG_LEVEL || (isLocal ? 'debug' : 'info');

  return {
    pinoHttp: {
      level: logLevel,
      // ISO 8601 타임스탬프 (예: "time":"2026-09-19T09:17:15.123Z")
      timestamp: pino.stdTimeFunctions.isoTime,

      // 로컬 개발 환경: pino-pretty, 외부 서버(dev, qa, prod): Loki 호환 단일 라인 JSON
      transport: getPrettyTransport(isLocal),

      // HTTP 요청마다 고유 Request ID 생성 및 응답 헤더(x-request-id) 전파
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const existingHeader = req.headers['x-request-id'];
        const id =
          (Array.isArray(existingHeader)
            ? existingHeader[0]
            : existingHeader) || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },

      // HTTP 요청 로그에 'HTTP' 컨텍스트 및 공통 메타데이터 주입
      customProps: (req: IncomingMessage, res: ServerResponse) => ({
        context: 'HTTP',
      }),

      // 에러 객체 표준 직렬화
      serializers: {
        err: pino.stdSerializers.err,
        req: (req: IncomingMessage) => ({
          id: (req as IncomingMessage & { id?: string }).id,
          method: req.method,
          url: req.url,
          headers: {
            host: req.headers.host,
            'user-agent': req.headers['user-agent'],
            'x-forwarded-for': req.headers['x-forwarded-for'],
          },
        }),
        res: (res: ServerResponse) => ({
          statusCode: res.statusCode,
        }),
      },

      // 보안상 로그에 노출되면 안 되는 민감 정보 마스킹 (Redaction)
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.token',
          'req.body.refreshToken',
          '*.password',
        ],
        censor: '[REDACTED]',
      },

      // 자동 HTTP 요청 완료 로그 메시지
      customSuccessMessage: (
        req: IncomingMessage,
        res: ServerResponse,
        responseTime: number,
      ) => {
        return `${req.method} ${req.url} ${res.statusCode} - ${responseTime}ms`;
      },

      // 자동 HTTP 요청 에러 로그 메시지
      customErrorMessage: (
        req: IncomingMessage,
        res: ServerResponse,
        error: Error,
      ) => {
        return `${req.method} ${req.url} ${res.statusCode} - Error: ${error.message}`;
      },
    },
  };
}
