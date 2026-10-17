import { describe, it, expect } from 'vitest';
import { formatContentDisposition } from './content-disposition.util.js';

describe('formatContentDisposition (RFC 6266 / RFC 5987 표준 헤더 생성)', () => {
  it('영문 파일명에 대해 기본 attachment disposition 및 인코딩된 헤더를 생성해야 한다', () => {
    // given
    const filename = 'document.pdf';

    // when
    const header = formatContentDisposition(filename);

    // then
    expect(header).toBe(
      'attachment; filename="document.pdf"; filename*=UTF-8\'\'document.pdf',
    );
  });

  it('한글 및 공백이 포함된 파일명에 대해 ASCII 대체 파일명과 UTF-8 인코딩을 생성해야 한다', () => {
    // given
    const filename = '프로젝트 계획서 2026.pdf';

    // when
    const header = formatContentDisposition(filename);

    // then
    // ASCII 대체는 한글이 '_'로 치환되고 공백은 보존됨
    expect(header).toContain('filename="____ ___ 2026.pdf"');
    expect(header).toContain(
      "filename*=UTF-8''%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20%EA%B3%84%ED%9A%8D%EC%84%9C%202026.pdf",
    );
  });

  it('따옴표 또는 줄바꿈 등 위험한 문자가 포함된 경우 치환되어야 한다', () => {
    // given
    const filename = 'test"injection.pdf';

    // when
    const header = formatContentDisposition(filename);

    // then
    expect(header).toContain('filename="test_injection.pdf"');
    expect(header).toContain("filename*=UTF-8''test%22injection.pdf");
  });

  it('inline disposition 지정 시 정상적으로 반영되어야 한다', () => {
    // given
    const filename = 'preview.svg';

    // when
    const header = formatContentDisposition(filename, 'inline');

    // then
    expect(header).toBe(
      'inline; filename="preview.svg"; filename*=UTF-8\'\'preview.svg',
    );
  });
});
