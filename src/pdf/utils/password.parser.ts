/// <reference types="multer" />
import type { MergeFileInput } from '../pdf.service.js';

/**
 * 폼 필드나 JSON 문자열 형태로 넘어온 비밀번호 목록을 count 길이에 맞춰 정규화 파싱합니다.
 */
export function parsePasswords(
  raw?: string | string[],
  count = 0,
): (string | undefined)[] {
  if (!raw) return Array.from({ length: count }, () => undefined);

  let list: string[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        list = parsed.map((item) => String(item ?? ''));
      } else {
        list = [raw];
      }
    } catch {
      list = [raw];
    }
  }

  const result: (string | undefined)[] = [];
  for (let i = 0; i < count; i++) {
    const pw = list[i]?.trim();
    result.push(pw && pw.length > 0 ? pw : undefined);
  }
  return result;
}

/**
 * 업로드된 파일 배열과 비밀번호 입력을 조합하여 병합 서비스 입력 배열로 변환합니다.
 */
export function buildMergeInputs(
  files: Express.Multer.File[],
  passwordsRaw?: string | string[],
): MergeFileInput[] {
  const passwords = parsePasswords(passwordsRaw, files.length);
  return files.map((f, i) => ({
    buffer: f.buffer,
    password: passwords[i],
  }));
}
