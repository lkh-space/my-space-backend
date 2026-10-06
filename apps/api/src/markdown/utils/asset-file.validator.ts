import { InvalidAssetException } from '../exceptions/markdown.exception.js';

export const MAX_ASSET_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

/**
 * 업로드된 이미지/에셋 파일 유효성 검증
 */
export function validateAssetFile(file?: Express.Multer.File): void {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new InvalidAssetException('업로드할 파일이 제공되지 않았습니다.');
  }

  if (file.size > MAX_ASSET_FILE_SIZE) {
    throw new InvalidAssetException('파일 크기는 최대 10MB까지 가능합니다.');
  }

  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new InvalidAssetException(
      `지원하지 않는 이미지 형식입니다 (${file.mimetype}). JPEG, PNG, GIF, WebP, SVG만 지원합니다.`,
    );
  }

  // 매직 바이트 검증
  const buffer = file.buffer;
  if (!verifyMagicBytes(buffer, file.mimetype)) {
    throw new InvalidAssetException('파일 내용이 실제 이미지 규격과 일치하지 않습니다.');
  }
}

function verifyMagicBytes(buffer: Buffer, mimetype: string): boolean {
  if (mimetype === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (mimetype === 'image/gif') {
    return (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    );
  }
  if (mimetype === 'image/webp') {
    return (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (mimetype === 'image/svg+xml') {
    const text = buffer.subarray(0, 500).toString('utf-8').trim();
    return text.includes('<svg') || text.startsWith('<?xml');
  }
  return false;
}
