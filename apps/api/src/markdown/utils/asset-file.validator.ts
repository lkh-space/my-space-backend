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

  // 매직 바이트 및 파일 무결성/보안 검증
  const buffer = file.buffer;
  if (!verifyMagicBytes(buffer, file.mimetype)) {
    throw new InvalidAssetException(
      file.mimetype === 'image/svg+xml'
        ? 'SVG 파일 내용이 유효하지 않거나 위험한 스크립트/외부 엔티티가 포함되어 있습니다.'
        : '파일 내용이 실제 이미지 규격과 일치하지 않습니다.',
    );
  }
}

/**
 * 위험한 SVG 내부 패턴 (XSS 및 XXE 방어)
 */
const DANGEROUS_SVG_PATTERNS = [
  /<script[\s>]/i,
  /<\/script>/i,
  /\bon\w+\s*=/i, // onload=, onerror=, onclick=, onmouseover= 등
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
  /<foreignobject[\s>]/i,
  /<!entity/i,
  /<!doctype[^>]*system/i,
];

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
    return isSafeSvg(buffer);
  }
  return false;
}

/**
 * SVG 파일의 구조 유효성 및 악성 스크립트 포함 여부 검증
 */
function isSafeSvg(buffer: Buffer): boolean {
  const content = buffer.toString('utf-8').trim();
  if (content.length === 0) {
    return false;
  }

  // 기본 SVG 루트 태그 또는 XML 선언 존재 여부 확인
  const hasSvgTag = content.includes('<svg') && content.includes('</svg>');
  if (!hasSvgTag) {
    return false;
  }

  // 위험한 스크립트, 이벤트 핸들러, 외부 엔티티 패턴 검사
  for (const pattern of DANGEROUS_SVG_PATTERNS) {
    if (pattern.test(content)) {
      return false;
    }
  }

  return true;
}
