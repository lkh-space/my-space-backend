import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

/**
 * 버퍼 데이터를 임시 파일로 저장하고 콜백을 실행한 후,
 * 성공/실패 여부와 관계없이 임시 파일을 안전하게 삭제(파기)합니다.
 *
 * @param buffer 임시 파일로 기록할 버퍼
 * @param fn 임시 파일 경로를 받아 비동기 작업을 수행하는 콜백
 * @param extension 파일 확장자 (기본: '.pdf')
 */
export async function withTempFile<T>(
  buffer: Buffer,
  fn: (tempPath: string) => Promise<T>,
  extension = '.pdf',
): Promise<T> {
  const tempDir = os.tmpdir();
  const uniqueId = crypto.randomUUID();
  const tempFilePath = path.join(tempDir, `pdf-tool-${uniqueId}${extension}`);

  await fs.writeFile(tempFilePath, buffer);
  try {
    return await fn(tempFilePath);
  } finally {
    try {
      await fs.unlink(tempFilePath);
    } catch {
      // 이미 삭제되었거나 정리 중 발생한 에러는 조용히 무시하여 비즈니스 에러를 가리지 않음
    }
  }
}

/**
 * 작업 중 생성된 출력용 임시 파일 경로를 할당하고,
 * 콜백 완료 후 생성된 파일을 읽어 버퍼로 반환한 뒤 임시 파일을 안전하게 삭제합니다.
 *
 * @param fn 출력 임시 파일 경로를 인자로 받아 파일 생성을 수행하는 콜백
 * @param extension 파일 확장자 (기본: '.pdf')
 */
export async function withTempOutputFile(
  fn: (outputPath: string) => Promise<void>,
  extension = '.pdf',
): Promise<Buffer> {
  const tempDir = os.tmpdir();
  const uniqueId = crypto.randomUUID();
  const tempOutputPath = path.join(tempDir, `pdf-out-${uniqueId}${extension}`);

  try {
    await fn(tempOutputPath);
    return await fs.readFile(tempOutputPath);
  } finally {
    try {
      await fs.unlink(tempOutputPath);
    } catch {
      // 정리 중 에러 무시
    }
  }
}
