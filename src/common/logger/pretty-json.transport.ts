import build from 'pino-abstract-transport';

/**
 * Winston의 format.prettyPrint()와 동일하게
 * 로그 JSON 객체를 2칸 들여쓰기(2 spaces indentation)된 포맷으로 출력하는 Pino 트랜스포트
 */
export default async function () {
  return build(async function (source) {
    for await (const obj of source) {
      process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
    }
  });
}
