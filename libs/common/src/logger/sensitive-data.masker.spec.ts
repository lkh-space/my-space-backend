import { describe, it, expect } from 'vitest';
import {
  maskSensitiveData,
  isSensitiveKey,
  maskSensitiveString,
  SENSITIVE_FIELDS,
} from './sensitive-data.masker.js';

describe('sensitive-data.masker (BDD 단위 테스트 - M-13 정밀 마스킹 및 오탐 방지)', () => {
  describe('원시값 및 시스템 객체 처리', () => {
    it('null이나 undefined, 원시값은 그대로 반환한다', () => {
      // given & when & then
      expect(maskSensitiveData(null)).toBeNull();
      expect(maskSensitiveData(undefined)).toBeUndefined();
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
  });

  describe('오탐 방지 (False Positives Prevention - 부분 일치 오탐 차단)', () => {
    it('mapping, pinned, spinner는 pin 키워드가 포함되어 있어도 마스킹되지 않는다', () => {
      // given
      const diagnosticData = {
        mapping: { route: '/api/v1/users' },
        pinned: true,
        spinner: 'loading',
        pinpoint: 100,
      };

      // when
      const result = maskSensitiveData(diagnosticData) as typeof diagnosticData;

      // then
      expect(result.mapping).toEqual({ route: '/api/v1/users' });
      expect(result.pinned).toBe(true);
      expect(result.spinner).toBe('loading');
      expect(result.pinpoint).toBe(100);
    });

    it('tokensUsed, tokenCount, totalTokens는 token 키워드가 포함되어 있어도 통계 보존을 위해 마스킹되지 않는다', () => {
      // given
      const tokenStats = {
        tokensUsed: 1500,
        tokenCount: 42,
        totalTokens: 25000,
        tokens_remaining: 500,
      };

      // when
      const result = maskSensitiveData(tokenStats) as typeof tokenStats;

      // then
      expect(result.tokensUsed).toBe(1500);
      expect(result.tokenCount).toBe(42);
      expect(result.totalTokens).toBe(25000);
      expect(result.tokens_remaining).toBe(500);

      // isSensitiveKey 단위 검증
      expect(isSensitiveKey('tokensUsed')).toBe(false);
      expect(isSensitiveKey('tokenCount')).toBe(false);
      expect(isSensitiveKey('totalTokens')).toBe(false);
      expect(isSensitiveKey('tokens_remaining')).toBe(false);
      expect(isSensitiveKey('mapping')).toBe(false);
      expect(isSensitiveKey('pinned')).toBe(false);
      expect(isSensitiveKey('spinner')).toBe(false);
    });
  });

  describe('민감 필드 정밀 마스킹 (True Positives)', () => {
    it('단일 및 복합 pin 필드(pin, user_pin, userPin)는 정확히 마스킹된다', () => {
      // given
      const input = {
        pin: '1234',
        user_pin: '5678',
        userPin: '9999',
      };

      // when
      const result = maskSensitiveData(input) as Record<string, string>;

      // then
      expect(result.pin).toBe('****');
      expect(result.user_pin).toBe('****');
      expect(result.userPin).toBe('****');
    });

    it('단일 및 복합 token 필드(token, accessToken, refreshToken, auth_token)는 정확히 마스킹된다', () => {
      // given
      const input = {
        token: 'secret-token',
        accessToken: 'access-jwt',
        refreshToken: 'refresh-jwt',
        auth_token: 'auth-jwt',
      };

      // when
      const result = maskSensitiveData(input) as Record<string, string>;

      // then
      expect(result.token).toBe('****');
      expect(result.accessToken).toBe('****');
      expect(result.refreshToken).toBe('****');
      expect(result.auth_token).toBe('****');
    });

    it('누락되었던 민감 키워드(cookie, set-cookie, x-api-key, remote-*, privateKey, connectionString, database_url)가 정상 마스킹된다', () => {
      // given
      const sensitiveInput = {
        cookie: 'sessionId=abc123xyz',
        'set-cookie': 'refreshToken=jwt; HttpOnly',
        'x-api-key': 'live-api-key-999',
        apiKey: 'live-api-key-888',
        'remote-user': 'admin',
        'remote-email': 'admin@example.com',
        privateKey: '-----BEGIN RSA PRIVATE KEY-----',
        connectionString: 'postgres://user:pass@localhost:5432/db',
        database_url: 'postgres://user:pass@localhost:5432/db',
      };

      // when
      const result = maskSensitiveData(sensitiveInput) as Record<string, string>;

      // then
      expect(result.cookie).toBe('****');
      expect(result['set-cookie']).toBe('****');
      expect(result['x-api-key']).toBe('****');
      expect(result.apiKey).toBe('****');
      expect(result['remote-user']).toBe('****');
      expect(result['remote-email']).toBe('****');
      expect(result.privateKey).toBe('****');
      expect(result.connectionString).toBe('****');
      expect(result.database_url).toBe('****');
    });
  });

  describe('클래스 인스턴스(DTO, 커스텀 객체) 프로퍼티 순회 마스킹', () => {
    it('Plain Object가 아닌 커스텀 클래스 DTO 인스턴스의 내부 민감 필드도 누락 없이 마스킹한다', () => {
      // given
      class DocumentDetailDto {
        constructor(
          public id: string,
          public title: string,
          public apiKey: string,
          public secret: string,
        ) {}
      }

      const dtoInstance = new DocumentDetailDto(
        'doc-10',
        '공개 문서 제목',
        'secret-api-key',
        'internal-secret',
      );

      // when
      const result = maskSensitiveData(dtoInstance) as Record<string, unknown>;

      // then
      expect(result.id).toBe('doc-10');
      expect(result.title).toBe('공개 문서 제목');
      expect(result.apiKey).toBe('****');
      expect(result.secret).toBe('****');
    });
  });

  describe('문자열 내 PII 및 토큰 마스킹 (maskSensitiveString)', () => {
    it('Bearer 토큰을 문자열에서 마스킹한다', () => {
      // given
      const logMessage = 'User authenticated with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';

      // when
      const masked = maskSensitiveString(logMessage);

      // then
      expect(masked).toBe('User authenticated with Bearer ****');
    });

    it('JWT 토큰 패턴을 마스킹한다', () => {
      // given
      const logMessage = 'Token received: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

      // when
      const masked = maskSensitiveString(logMessage);

      // then
      expect(masked).toContain('****.****.****');
      expect(masked).not.toContain('eyJhbGci');
    });

    it('Key-Value 형태의 비밀번호/토큰 파라미터를 마스킹한다', () => {
      // given
      const queryStr = 'login?user=alice&password=SuperSecret123!&token=xyz999';

      // when
      const masked = maskSensitiveString(queryStr);

      // then
      expect(masked).toBe('login?user=alice&password=****&token=****');
    });
  });

  describe('순환 참조 및 중첩 구조 방어', () => {
    it('순환 참조가 있는 객체도 스택 오버플로우 없이 [Circular]로 안전하게 처리한다', () => {
      // given
      const circularObj: any = {
        name: 'root',
        password: 'secretPassword',
      };
      circularObj.self = circularObj;

      // when
      const result = maskSensitiveData(circularObj) as any;

      // then
      expect(result.password).toBe('****');
      expect(result.self).toBe('[Circular]');
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
  });

  describe('SENSITIVE_FIELDS 하위 호환성', () => {
    it('SENSITIVE_FIELDS 목록이 포함되어 있다', () => {
      expect(SENSITIVE_FIELDS).toContain('password');
      expect(SENSITIVE_FIELDS).toContain('token');
      expect(SENSITIVE_FIELDS).toContain('apiKey');
      expect(SENSITIVE_FIELDS).toContain('pin');
    });
  });
});
