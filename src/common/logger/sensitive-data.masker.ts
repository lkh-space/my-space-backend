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
 * 객체, 배열 또는 원시 값을 재귀적으로 순회하여
 * 민감 필드(비밀번호, 토큰 등)의 값을 '****'로 마스킹합니다.
 *
 * @param obj 마스킹 검사 대상 객체
 * @returns 민감 정보가 마스킹된 새로운 객체
 */
export function maskSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Date, Buffer 등 특수 객체는 변형 없이 그대로 반환
  if (obj instanceof Date || Buffer.isBuffer(obj)) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => maskSensitiveData(item));
  }

  if (typeof obj === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = SENSITIVE_FIELDS.some((field) =>
        lowerKey.includes(field.toLowerCase()),
      );

      if (isSensitive && value !== null && value !== undefined) {
        masked[key] = '****';
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = maskSensitiveData(value);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }

  return obj;
}
