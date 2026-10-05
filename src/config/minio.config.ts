import { registerAs } from '@nestjs/config';

/**
 * MinIO (S3 호환 오브젝트 스토리지) 네임스페이스 설정 ('minio')
 */
export const minioConfig = registerAs('minio', () => ({
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  port: Number(process.env.MINIO_PORT) || 9000,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || '',
  secretKey: process.env.MINIO_SECRET_KEY || '',
  bucketDocs: process.env.MINIO_BUCKET_DOCS || 'my-space-markdown',
  bucketAssets: process.env.MINIO_BUCKET_ASSETS || 'my-space-assets',
  region: process.env.MINIO_REGION || 'us-east-1',
  forcePathStyle: process.env.MINIO_FORCE_PATH_STYLE !== 'false',
}));
