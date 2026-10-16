import { describe, it, expect } from 'vitest';
import {
  validateAssetFile,
  MAX_ASSET_FILE_SIZE,
} from './asset-file.validator.js';
import { InvalidAssetException } from '../exceptions/markdown.exception.js';

function createMockMulterFile(
  mimetype: string,
  buffer: Buffer,
  size = buffer.length,
  originalname = 'test-file',
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype,
    buffer,
    size,
    destination: '',
    filename: '',
    path: '',
    stream: null as never,
  };
}

describe('asset-file.validator (에셋 파일 유효성 및 보안 검증)', () => {
  describe('정상 이미지 파일 검증', () => {
    it('유효한 JPEG 파일은 검증을 통과해야 한다', () => {
      // given
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const file = createMockMulterFile('image/jpeg', jpegBuffer);

      // when & then
      expect(() => validateAssetFile(file)).not.toThrow();
    });

    it('유효한 PNG 파일은 검증을 통과해야 한다', () => {
      // given
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      const file = createMockMulterFile('image/png', pngBuffer);

      // when & then
      expect(() => validateAssetFile(file)).not.toThrow();
    });

    it('유효한 GIF 파일은 검증을 통과해야 한다', () => {
      // given
      const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      const file = createMockMulterFile('image/gif', gifBuffer);

      // when & then
      expect(() => validateAssetFile(file)).not.toThrow();
    });

    it('유효한 WebP 파일은 검증을 통과해야 한다', () => {
      // given
      const webpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50, // WEBP
      ]);
      const file = createMockMulterFile('image/webp', webpBuffer);

      // when & then
      expect(() => validateAssetFile(file)).not.toThrow();
    });

    it('스크립트가 없는 순수한 SVG 파일은 검증을 통과해야 한다', () => {
      // given
      const safeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red" /></svg>';
      const file = createMockMulterFile('image/svg+xml', Buffer.from(safeSvg, 'utf-8'));

      // when & then
      expect(() => validateAssetFile(file)).not.toThrow();
    });
  });

  describe('파일 크기 및 기본 유효성 검증', () => {
    it('파일이 누락되었거나 버퍼가 비어있으면 InvalidAssetException을 던져야 한다', () => {
      // given
      const emptyFile = createMockMulterFile('image/png', Buffer.alloc(0));

      // when & then
      expect(() => validateAssetFile(undefined)).toThrow(InvalidAssetException);
      expect(() => validateAssetFile(emptyFile)).toThrow(InvalidAssetException);
    });

    it('10MB를 초과하는 파일은 InvalidAssetException을 던져야 한다', () => {
      // given
      const oversizedBuffer = Buffer.alloc(MAX_ASSET_FILE_SIZE + 1);
      const file = createMockMulterFile('image/png', oversizedBuffer, oversizedBuffer.length);

      // when & then
      expect(() => validateAssetFile(file)).toThrow(InvalidAssetException);
      expect(() => validateAssetFile(file)).toThrow('최대 10MB');
    });

    it('허용되지 않은 MIME 타입(예: application/pdf)은 InvalidAssetException을 던져야 한다', () => {
      // given
      const file = createMockMulterFile('application/pdf', Buffer.from('%PDF-1.4'));

      // when & then
      expect(() => validateAssetFile(file)).toThrow(InvalidAssetException);
      expect(() => validateAssetFile(file)).toThrow('지원하지 않는 이미지 형식');
    });

    it('MIME 타입과 실제 매직 바이트가 일치하지 않으면 InvalidAssetException을 던져야 한다', () => {
      // given: MIME은 PNG이지만 내용은 가짜 바이트
      const fakeBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      const file = createMockMulterFile('image/png', fakeBuffer);

      // when & then
      expect(() => validateAssetFile(file)).toThrow(InvalidAssetException);
      expect(() => validateAssetFile(file)).toThrow('실제 이미지 규격과 일치하지 않습니다');
    });
  });

  describe('SVG XSS 및 보안 위협 방어 검증 (H-2)', () => {
    it('<script> 태그가 포함된 SVG 파일은 InvalidAssetException을 던져야 한다', () => {
      // given
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert("XSS")</script></svg>`;
      const file = createMockMulterFile('image/svg+xml', Buffer.from(maliciousSvg, 'utf-8'));

      // when & then
      expect(() => validateAssetFile(file)).toThrow(InvalidAssetException);
      expect(() => validateAssetFile(file)).toThrow('위험한 스크립트/외부 엔티티');
    });

    it('인라인 이벤트 핸들러(onload=)가 포함된 SVG 파일은 InvalidAssetException을 던져야 한다', () => {
      // given
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert('XSS')"><rect width="100" height="100" /></svg>`;
      const file = createMockMulterFile('image/svg+xml', Buffer.from(maliciousSvg, 'utf-8'));

      // when & then
      expect(() => validateAssetFile(file)).toThrow(InvalidAssetException);
      expect(() => validateAssetFile(file)).toThrow('위험한 스크립트/외부 엔티티');
    });

    it('onerror= 등 다른 이벤트 핸들러가 포함된 SVG 파일도 거부해야 한다', () => {
      // given
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="invalid.jpg" onerror="alert('XSS')" /></svg>`;
      const file = createMockMulterFile('image/svg+xml', Buffer.from(maliciousSvg, 'utf-8'));

      // when & then
      expect(() => validateAssetFile(file)).toThrow(InvalidAssetException);
    });

    it('javascript: 스킴이 포함된 SVG 링크는 거부해야 한다', () => {
      // given
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>Click</text></a></svg>`;
      const file = createMockMulterFile('image/svg+xml', Buffer.from(maliciousSvg, 'utf-8'));

      // when & then
      expect(() => validateAssetFile(file)).toThrow(InvalidAssetException);
    });

    it('<foreignObject> 태그가 포함된 SVG 파일은 HTML 인라인 실행 위험으로 거부해야 한다', () => {
      // given
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="100" height="100"><body xmlns="http://www.w3.org/1999/xhtml"><div>XSS</div></body></foreignObject></svg>`;
      const file = createMockMulterFile('image/svg+xml', Buffer.from(maliciousSvg, 'utf-8'));

      // when & then
      expect(() => validateAssetFile(file)).toThrow(InvalidAssetException);
    });

    it('XXE(XML External Entity) 선언이 포함된 SVG 파일은 거부해야 한다', () => {
      // given
      const xxeSvg = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&xxe;</svg>`;
      const file = createMockMulterFile('image/svg+xml', Buffer.from(xxeSvg, 'utf-8'));

      // when & then
      expect(() => validateAssetFile(file)).toThrow(InvalidAssetException);
    });

    it('올바르게 닫히지 않은 손상된 SVG 파일은 거부해야 한다', () => {
      // given
      const brokenSvg = `<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="10">`;
      const file = createMockMulterFile('image/svg+xml', Buffer.from(brokenSvg, 'utf-8'));

      // when & then
      expect(() => validateAssetFile(file)).toThrow(InvalidAssetException);
    });
  });
});
