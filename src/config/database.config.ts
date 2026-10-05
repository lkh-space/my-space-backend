import { registerAs } from '@nestjs/config';

/**
 * 데이터베이스(PostgreSQL / Prisma) 네임스페이스 설정 ('database')
 */
export const databaseConfig = registerAs('database', () => ({
  url:
    process.env.DATABASE_URL ||
    `postgresql://${process.env.DATABASE_USER || 'postgres'}:${process.env.DATABASE_PASSWORD || ''}@${process.env.DATABASE_HOST || 'localhost'}:${process.env.DATABASE_PORT || 5432}/${process.env.DATABASE_NAME || 'homelab_db'}`,
  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT) || 5432,
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME || 'homelab_db',
}));
