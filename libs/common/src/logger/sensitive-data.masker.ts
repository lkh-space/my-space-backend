/**
 * 마스킹 대상 민감 필드 키워드 목록 (하위 호환성 유지)
 */
export const SENSITIVE_FIELDS = [
  'password',
  'passwordConfirm',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'authorization',
  'creditCard',
  'ssn',
  'pin',
  'cookie',
  'privateKey',
  'connectionString',
];

/**
 * 키 이름 기반 정밀 정규식 패턴 목록
 *
 * 1) 부분 문자열 과잉 매칭 방지:
 *    - 'pin': 단독 'pin', 'user_pin', 'userPin' 등은 마스킹하되, 'mapping', 'pinned', 'spinner'는 제외
 *    - 'token': 'token', 'accessToken', 'refreshToken' 등은 마스킹하되, 'tokensUsed', 'tokenCount', 'totalTokens'는 제외
 * 2) 누락 민감 정보 커버:
 *    - cookie, set-cookie, x-api-key, remote-*, privateKey, connectionString, database_url 등 포함
 */
export const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  // password / passwd / passwordConfirm (예: password, currentPassword, new_password, userPasswd)
  /^.*(password|passwd)(confirm)?$/i,
  // secret / clientSecret
  /^.*secret$/i,
  // token (예: token, accessToken, refresh_token, sessionToken)
  // 단, tokensUsed, tokenCount, totalTokens 등 토큰 통계 지표는 isSensitiveKey에서 명시적 제외
  /^.*token$/i,
  // api key / x-api-key
  /^.*api[-_]?key$/i,
  // authorization / auth
  /^.*auth(orization)?$/i,
  // cookie / set-cookie
  /^.*(set[-_]?)?cookie$/i,
  // pin / user_pin / userPin (반드시 pin으로 끝나야 함 -> mapping, pinned, spinner, pinpoint 등 오탐 원천 방지)
  /(^|[_.-]|[a-z])pin$/i,
  // credit card
  /^.*credit[-_]?card$/i,
  // ssn
  /^.*ssn$/i,
  // private key
  /^.*private[-_]?key$/i,
  // connection string / database url
  /^.*(connection[-_]?string|database[-_]?url)$/i,
  // remote-* (Authelia 리버스 프록시 Forward Auth 헤더)
  /^remote[-_](user|email|name|groups|.*)$/i,
];

/**
 * 주어진 키 이름이 민감 정보 필드인지 검사합니다.
 */
export function isSensitiveKey(key: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }
  const trimmed = key.trim();
  // tokensUsed, tokenCount, totalTokens 등 토큰 통계 지표는 마스킹 대상에서 명시적 제외
  if (/^total_?tokens$|^tokens?_?(used|count|remaining|allocated)$/i.test(trimmed)) {
    return false;
  }
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * 문자열 내에 포함된 Bearer 토큰, JWT, API Key 형태의 PII를 정규식으로 마스킹합니다.
 */
export function maskSensitiveString(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  return (
    text
      // 1. Bearer 토큰 마스킹 (예: "Bearer eyJhbGci..." -> "Bearer ****")
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer ****')
      // 2. JWT 토큰 패턴 마스킹 (3단 dot 구분 base64 문자열)
      .replace(/eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g, '****.****.****')
      // 3. Key-Value 파라미터 내 민감정보 마스킹 (예: password=1234 -> password=****)
      .replace(
        /((?:password|passwd|secret|api[-_]?key|token)=)([^&\s"'`]+)/gi,
        '$1****',
      )
  );
}

/**
 * 순회 가능한 객체인지 판별합니다.
 * 순수 객체(Plain Object)뿐만 아니라 클래스 인스턴스(DTO, 커스텀 에러 등)도 순회 대상에 포함하되,
 * Date, Buffer, RegExp, Socket, Stream 등 시스템 및 바이너리 객체는 순회에서 제외합니다.
 */
function isTraversableObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  // 시스템 및 바이너리/원시 래퍼 객체 제외
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    Buffer.isBuffer(value)
  ) {
    return false;
  }

  // Node.js Stream, Socket, HTTP 요청/응답 객체 제외 (순환 및 I/O 위험)
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.pipe === 'function' ||
    typeof candidate.socket === 'object' ||
    typeof candidate.emit === 'function'
  ) {
    return false;
  }

  return true;
}

/**
 * 객체, 배열 또는 원시 값을 재귀적으로 순회하여
 * 민감 필드(비밀번호, 토큰 등)의 값을 '****'로 마스킹합니다.
 *
 * 순환 참조(WeakSet) 및 최대 탐색 깊이(Max Depth) 방어 로직을 포함하여
 * 스택 오버플로우를 원천 차단합니다.
 *
 * @param obj 마스킹 검사 대상 객체 또는 원시값
 * @param seen 순환 참조 감지용 WeakSet
 * @param depth 현재 재귀 깊이
 * @param maxDepth 최대 허용 재귀 깊이 (기본 6)
 * @returns 민감 정보가 마스킹된 결과
 */
export function maskSensitiveData(
  obj: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
  maxDepth = 6,
): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // 최대 탐색 깊이 초과 시 추가 재귀 방지
  if (depth > maxDepth) {
    return obj;
  }

  // 문자열 원시 값: JWT, Bearer 토큰 등 정규식 마스킹 적용
  if (typeof obj === 'string') {
    return maskSensitiveString(obj);
  }

  // 기타 원시 값(숫자, 불리언 등)은 그대로 반환
  if (typeof obj !== 'object') {
    return obj;
  }

  // 순환 참조 감지: 이미 방문한 객체인 경우 순환 링크 차단
  if (seen.has(obj)) {
    return '[Circular]';
  }
  seen.add(obj);

  // 배열 처리
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      maskSensitiveData(item, seen, depth + 1, maxDepth),
    );
  }

  // 순회 가능한 객체(순수 객체 + DTO/클래스 인스턴스)가 아닌 경우 원본 보존
  if (!isTraversableObject(obj)) {
    return obj;
  }

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = isSensitiveKey(key);

    if (isSensitive && value !== null && value !== undefined) {
      masked[key] = '****';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveData(value, seen, depth + 1, maxDepth);
    } else if (typeof value === 'string') {
      masked[key] = maskSensitiveString(value);
    } else {
      masked[key] = value;
    }
  }

  return masked;
}
