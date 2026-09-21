---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-09-20
---

# 환경 설정 및 ConfigService 사양서 (Configuration Specification)

## 1. 개요 (Summary)
애플리케이션 전반의 환경변수(`process.env`) 직접 참조를 지양하고, NestJS 12 공식 지원 검증 라이브러리인 **Zod**와 `@nestjs/config`를 결합하여 타입 안전하고 모듈화된 환경 설정 관리 체계를 수립합니다.

## 2. 목표 및 제외 대상 (Goals / Non-goals)

### 목표 (Goals)
* **Zod 기반 런타임 스키마 검증**: 잘못된 환경변수 값이나 필수값 누락 시 애플리케이션 시작 시점에 즉시 기동 실패(Fail-fast) 처리
* **모듈별 네임스페이스(`registerAs`) 분리**: 기본 서버 설정(`app`), 향후 DB(`database`), Redis(`redis`), 인증(`auth`) 등 도메인별 설정 독립 관리
* **단일 `.env` 기반 로컬 DX**: 향후 모노레포로 확장되더라도 로컬 개발 시에는 프로젝트 루트의 단일 `.env` 파일로 통합 관리
* **운영 배포 환경 호환**: 컨테이너 환경(Kubernetes, Docker)에서 주입되는 시스템 환경변수 완벽 지원
* **타입 안전성(Type Safety)**: `ConfigType<typeof appConfig>`를 통한 컴파일 타임 타입 추론 및 자동완성 지원

### 제외 대상 (Non-goals)
* 외부 원격 설정 저장소(AWS Secrets Manager, HashiCorp Vault 등) 실시간 폴링 (추후 필요 시 확장)

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-C01` | 서버 런타임 | 환경변수 로드 및 검증 | 부트스트랩 시 `.env` 및 시스템 환경변수를 Zod로 검증 후 ConfigModule 초기화 |
| `UC-C02` | 개발자 | 잘못된 환경변수 감지 | 올바르지 않은 값 입력 시 명확한 Zod 검증 에러 메시지와 함께 기동 중단 |
| `UC-C03` | 서비스 / 모듈 | 타입 안전한 설정 주입 | `@Inject(appConfig.KEY)` 또는 `ConfigService`를 통해 타입 안정성이 보장된 설정값 사용 |
| `UC-C04` | 로거 모듈 | 설정 기반 로거 초기화 | `ConfigService`를 통해 `isLocal`, `logLevel`을 비동기로 주입받아 Pino 로거 구성 |

## 4. 비즈니스 규칙 (Business Rules)

* **`BR-C01` (환경변수 직접 참조 금지)**: 비즈니스 로직, 서비스, 컨트롤러 내에서 `process.env.XXX`를 직접 호출하지 않고 반드시 `ConfigService` 또는 네임스페이스 설정을 주입받아 사용한다.
* **`BR-C02` (기본값 및 타입 강제)**:
  - `PORT`: 숫자형 (기본값: `3000`, 1~65535 범위)
  - `NODE_ENV`: `'development'` | `'production'` | `'test'` (기본값: `'development'`)
  - `IS_LOCAL`: 불리언 문자열 파싱 (`'true'` -> `true`, 기본값: `false`)
  - `LOG_LEVEL`: `'debug'` | `'info'` | `'warn'` | `'error'` (기본값: `isLocal ? 'debug' : 'info'`)
* **`BR-C03` (Fail-Fast 검증)**: 환경변수 검증에 실패할 경우 자세한 필드 에러 내역을 콘솔에 출력하고 프로세스를 종료한다.
* **`BR-C04` (모듈 네임스페이스 독립성)**: 각 도메인 설정은 `registerAs`를 통해 고유 키(`app`, `database` 등)로 격리하여 향후 모노레포 라이브러리(`libs/`) 전환 시 결합도를 최소화한다.

## 5. 인터페이스 및 Zod 스키마 설계

### 5.1. 환경변수 Zod 스키마 (`env.validation.ts`)

```typescript
import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  IS_LOCAL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((val) => val === 'true'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;
```

### 5.2. 기본 서버 네임스페이스 설정 (`app.config.ts`)

```typescript
import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isLocal: process.env.IS_LOCAL === 'true',
  logLevel: process.env.LOG_LEVEL || (process.env.IS_LOCAL === 'true' ? 'debug' : 'info'),
}));
```

## 6. 예외 처리 및 에러 스펙 (Error Handling)

| 에러 상황 | 발생 위치 | 동작 결과 |
| :--- | :--- | :--- |
| `PORT`에 숫자가 아닌 문자열 입력 | `validateEnv` (Zod) | 에러 필드와 사유 출력 후 앱 부트스트랩 즉시 중단 |
| `NODE_ENV`에 허용되지 않은 값 입력 | `validateEnv` (Zod) | 허용 enum 목록 출력 후 앱 부트스트랩 즉시 중단 |

## 7. 결정된 사항 (Decisions)

* [x] **Zod 채택**: NestJS 12 공식 지원 및 간결한 스키마 정의, 완벽한 TypeScript 추론을 위해 Zod를 사용.
* [x] **단일 `.env` 유지**: 향후 모노레포 전환 시에도 로컬 개발 편의를 위해 루트 단일 `.env` 파일 유지.
