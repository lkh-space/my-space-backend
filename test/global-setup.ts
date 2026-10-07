import { execSync } from 'node:child_process';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

let postgresContainer: StartedPostgreSqlContainer;

export default async function setup() {
  console.log('\n[E2E Global Setup] PostgreSQL Testcontainer 기동 중...');

  postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('test_myspace')
    .withUsername('test_user')
    .withPassword('test_password')
    .start();

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
