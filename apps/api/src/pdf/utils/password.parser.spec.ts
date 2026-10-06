/// <reference types="multer" />
import { describe, it, expect } from 'vitest';
import { parsePasswords, buildMergeInputs } from './password.parser.js';

describe('password.parser (BDD 단위 테스트)', () => {
  describe('parsePasswords', () => {
    it('raw가 undefined인 경우 count 길이만큼 undefined 배열을 반환한다', () => {
      // given
      const count = 3;

      // when
      const result = parsePasswords(undefined, count);

      // then
      expect(result).toEqual([undefined, undefined, undefined]);
    });

    it('raw가 배열인 경우 공백을 trim하고 빈 문자열은 undefined로 변환한다', () => {
      // given
      const raw = ['pass1', '  ', 'pass3'];
      const count = 3;

      // when
      const result = parsePasswords(raw, count);

      // then
      expect(result).toEqual(['pass1', undefined, 'pass3']);
    });

    it('raw가 JSON 배열 문자열인 경우 JSON 파싱 후 정규화한다', () => {
      // given
      const raw = '["secret1", "secret2"]';
      const count = 3;

      // when
      const result = parsePasswords(raw, count);

      // then
      expect(result).toEqual(['secret1', 'secret2', undefined]);
    });

    it('raw가 일반 단일 문자열인 경우 단일 요소 배열로 처리한다', () => {
      // given
      const raw = 'singlePassword';
      const count = 2;

      // when
      const result = parsePasswords(raw, count);

      // then
      expect(result).toEqual(['singlePassword', undefined]);
    });
  });

  describe('buildMergeInputs', () => {
    it('파일 목록과 비밀번호 배열을 매핑하여 MergeFileInput 목록을 생성한다', () => {
      // given
      const buf1 = Buffer.from('%PDF-1');
      const buf2 = Buffer.from('%PDF-2');
      const mockFiles = [
        { buffer: buf1, size: buf1.length } as Express.Multer.File,
        { buffer: buf2, size: buf2.length } as Express.Multer.File,
      ];
      const passwordsJson = '["pw1", ""]';

      // when
      const inputs = buildMergeInputs(mockFiles, passwordsJson);

      // then
      expect(inputs).toEqual([
        { buffer: buf1, password: 'pw1' },
        { buffer: buf2, password: undefined },
      ]);
    });
  });
});
