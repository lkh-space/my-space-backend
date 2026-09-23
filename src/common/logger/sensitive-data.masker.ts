/**
 * 마스킹 대상 민감 필드 키워드 목록
 * (키 이름에 해당 키워드가 대소문자 구분 없이 부분 포함되면 마스킹 대상이 됩니다)
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
];

/**
 * 순수 객체(Plain Object: Object.prototype을 직접 상속받거나 null 상속)인지 확인합니다.
 * Socket, Stream, IncomingMessage 등 복잡한 Node.js 내부 인스턴스를 재귀 탐색에서 제외합니다.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/**
 * 객체, 배열 또는 원시 값을 재귀적으로 순회하여
 * 민감 필드(비밀번호, 토큰 등)의 값을 '****'로 마스킹합니다.
 *
 * 순환 참조(WeakSet) 및 최대 탐색 깊이(Max Depth) 방어 로직을 포함하여
 * 스택 오버플로우(Maximum call stack size exceeded)를 원천 차단합니다.
 *
 * @param obj 마스킹 검사 대상 객체
 * @param seen 순환 참조 감지용 WeakSet
 * @param depth 현재 재귀 깊이
 * @param maxDepth 최대 허용 재귀 깊이 (기본 6)
 * @returns 민감 정보가 마스킹된 새로운 객체
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

  // 최대 탐색 깊이 초과 시 추가 재귀 방지 (스택 오버플로우 원천 차단)
  if (depth > maxDepth) {
    return obj;
  }

  // 원시 값(문자열, 숫자, 불리언 등)은 그대로 반환
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

  // 순수 객체(Plain Object)가 아닌 특수 인스턴스(Date, Buffer, Socket, Stream, Error 등)는 프로퍼티 재귀 제외
  if (!isPlainObject(obj)) {
    return obj;
  }

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_FIELDS.some((field) =>
      lowerKey.includes(field.toLowerCase()),
    );

    if (isSensitive && value !== null && value !== undefined) {
      masked[key] = '****';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveData(value, seen, depth + 1, maxDepth);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
