import { BaseDomainException } from './domain.exception.js';

/**
 * 스토리지(S3/MinIO 등)에서 요청한 오브젝트를 찾을 수 없을 때 발생하는 예외
 */
export class StorageObjectNotFoundException extends BaseDomainException {
  readonly code = 'STORAGE_OBJECT_NOT_FOUND';

  constructor(bucket: string, key: string, reason?: string) {
    super(
      reason
        ? `스토리지 오브젝트를 찾을 수 없습니다 [bucket=${bucket}, key=${key}]: ${reason}`
        : `스토리지 오브젝트를 찾을 수 없습니다 [bucket=${bucket}, key=${key}]`,
      { bucket, key, reason },
    );
  }
}
