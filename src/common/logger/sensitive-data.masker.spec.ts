import { describe, it, expect } from 'vitest';
import {
  maskSensitiveData,
  SENSITIVE_FIELDS,
} from './sensitive-data.masker.js';

describe('sensitive-data.masker (BDD 단위 테스트)', () => {
  it('null이나 undefined, 원시값은 그대로 반환한다', () => {
    // given & when & then
    expect(maskSensitiveData(null)).toBeNull();
    expect(maskSensitiveData(undefined)).toBeUndefined();
    expect(maskSensitiveData('plain text')).toBe('plain text');
    expect(maskSensitiveData(12345)).toBe(12345);
    expect(maskSensitiveData(true)).toBe(true);
  });

  it('Date나 Buffer 인스턴스는 변형하지 않고 원본을 보존한다', () => {
    // given
    const now = new Date();
    const buf = Buffer.from('binary-data');

    // when
    const resultDate = maskSensitiveData(now);
    const resultBuf = maskSensitiveData(buf);

    // then
    expect(resultDate).toBe(now);
    expect(resultBuf).toBe(buf);
  });

  it('단일 객체의 민감 키 필드를 ****로 마스킹한다', () => {
    // given
    const input = {
      id: 'user-1',
      username: 'john_doe',
      password: 'mySecretPassword123!',
      passwordConfirm: 'mySecretPassword123!',
      token: 'jwt-access-token',
      refreshToken: 'jwt-refresh-token',
      apiKey: 'sk-1234567890',
      secret: 'super-secret-key',
      creditCard: '1234-5678-9012-3456',
      ssn: '900101-1234567',
      pin: '1234',
    };

    // when
    const result = maskSensitiveData(input) as Record<string, unknown>;

    // then
    expect(result.id).toBe('user-1');
    expect(result.username).toBe('john_doe');
    expect(result.password).toBe('****');
    expect(result.passwordConfirm).toBe('****');
    expect(result.token).toBe('****');
    expect(result.refreshToken).toBe('****');
    expect(result.apiKey).toBe('****');
    expect(result.secret).toBe('****');
    expect(result.creditCard).toBe('****');
    expect(result.ssn).toBe('****');
    expect(result.pin).toBe('****');
  });

  it('대소문자 구분 없이 부분 일치하는 필드도 마스킹한다 (예: passwords, userPassword, ACCESS_TOKEN)', () => {
    // given
    const input = {
      passwords: ['pw1', 'pw2'],
      userPassword: 'secretPassword',
      ACCESS_TOKEN: 'token-value',
      my_secret_code: 'code-123',
    };

    // when
    const result = maskSensitiveData(input) as Record<string, unknown>;

    // then
    expect(result.passwords).toBe('****');
    expect(result.userPassword).toBe('****');
    expect(result.ACCESS_TOKEN).toBe('****');
    expect(result.my_secret_code).toBe('****');
  });

  it('중첩된 객체 및 객체 배열 내부의 민감 정보도 재귀적으로 마스킹한다', () => {
    // given
    const input = {
      user: {
        profile: {
          name: 'Keunhyeok Lim',
          currentPassword: 'old-password',
          newPassword: 'new-password',
        },
      },
      sessions: [
        { device: 'mac', token: 'session-token-1' },
        { device: 'iphone', token: 'session-token-2' },
      ],
    };

    // when
    const result = maskSensitiveData(input) as any;

    // then
    expect(result.user.profile.name).toBe('Keunhyeok Lim');
    expect(result.user.profile.currentPassword).toBe('****');
    expect(result.user.profile.newPassword).toBe('****');
    expect(result.sessions[0].device).toBe('mac');
    expect(result.sessions[0].token).toBe('****');
    expect(result.sessions[1].token).toBe('****');
  });

  it('SENSITIVE_FIELDS 목록이 winston 설정과 동일하게 정의되어 있다', () => {
    // given & when & then
    expect(SENSITIVE_FIELDS).toContain('password');
    expect(SENSITIVE_FIELDS).toContain('passwordConfirm');
    expect(SENSITIVE_FIELDS).toContain('currentPassword');
    expect(SENSITIVE_FIELDS).toContain('newPassword');
    expect(SENSITIVE_FIELDS).toContain('token');
    expect(SENSITIVE_FIELDS).toContain('accessToken');
    expect(SENSITIVE_FIELDS).toContain('refreshToken');
    expect(SENSITIVE_FIELDS).toContain('apiKey');
    expect(SENSITIVE_FIELDS).toContain('secret');
    expect(SENSITIVE_FIELDS).toContain('authorization');
    expect(SENSITIVE_FIELDS).toContain('creditCard');
    expect(SENSITIVE_FIELDS).toContain('ssn');
    expect(SENSITIVE_FIELDS).toContain('pin');
  });
});
