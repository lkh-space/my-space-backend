import { execSync } from 'node:child_process';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

let postgresContainer: StartedPostgreSqlContainer;

export default async function setup() {
  // 1. 이미 별도의 테스트 DB URL이 지정된 경우 (Docker 미사용 환경 지원)
  if (process.env.TEST_DATABASE_URL) {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    console.log(`\n[E2E Global Setup] ℹ️ TEST_DATABASE_URL 감지됨. Testcontainers 대신 지정된 DB를 사용합니다: ${databaseUrl}`);

    process.env.DATABASE_URL = databaseUrl;
    process.env.IS_LOCAL = 'true';
    process.env.NODE_ENV = 'test';

    console.log('[E2E Global Setup] Prisma DB 스키마 푸시 실행...');
    execSync('pnpm prisma db push --skip-generate', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });
    console.log('[E2E Global Setup] Prisma DB 스키마 푸시 완료.');
    return async () => {};
  }

  // 2. Testcontainers 기반 격리된 PostgreSQL 컨테이너 기동
  console.log('\n[E2E Global Setup] PostgreSQL Testcontainer 기동 중...');

  try {
    postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test_myspace')
      .withUsername('test_user')
      .withPassword('test_password')
      .start();
  } catch (error: any) {
    console.error('\n' + '='.repeat(80));
    console.error('[E2E Global Setup] ❌ Docker 데몬 연결 실패로 Testcontainers를 기동할 수 없습니다.');
    console.error('👉 해결 방법:');
    console.error('   1. Docker Desktop 또는 Colima/OrbStack이 실행 중인지 확인해 주세요.');
    console.error('   2. 또는 별도의 로컬 PostgreSQL을 사용하려면 TEST_DATABASE_URL을 지정해 주세요:');
    console.error('      TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/test_db" pnpm run test:e2e');
    console.error('='.repeat(80) + '\n');
    throw error;
  }

  const databaseUrl = postgresContainer.getConnectionUri();
  console.log(`[E2E Global Setup] PostgreSQL Container 기동 완료: ${databaseUrl}`);

  process.env.DATABASE_URL = databaseUrl;
  process.env.IS_LOCAL = 'true';
  process.env.NODE_ENV = 'test';

  console.log('[E2E Global Setup] Prisma DB 스키마 푸시 실행...');
  try {
    execSync('pnpm prisma db push --skip-generate', {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      stdio: 'inherit',
    });
    console.log('[E2E Global Setup] Prisma DB 스키마 푸시 완료.');
  } catch (error) {
    console.error('[E2E Global Setup] Prisma DB 스키마 푸시 실패:', error);
    await postgresContainer.stop();
    throw error;
  }

  return async () => {
    console.log('\n[E2E Global Teardown] PostgreSQL Testcontainer 종료 중...');
    if (postgresContainer) {
      await postgresContainer.stop();
      console.log('[E2E Global Teardown] PostgreSQL Container 종료 완료.');
    }
  };
}
