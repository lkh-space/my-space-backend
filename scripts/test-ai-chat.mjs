#!/usr/bin/env node
/**
 * AI Chat API 직접 호출 테스트 스크립트
 *
 * 사용법:
 *   node scripts/test-ai-chat.mjs
 *   node scripts/test-ai-chat.mjs "원하는 질문 텍스트"
 */

const BASE_URL = process.env.AI_BASE_URL || 'http://localhost:3001';
const inputText =
  process.argv.slice(2).join(' ').trim() ||
  '안녕하세요! My Space 백엔드 AI 기능 테스트 중입니다. 짧게 한 문장으로 인사해줘.';

console.log('='.repeat(60));
console.log('🤖 [My Space] AI Chat API 로컬 연동 테스트');
console.log('='.repeat(60));
console.log(`📍 대상 서버: ${BASE_URL}`);
console.log(`💬 입력 텍스트: "${inputText}"\n`);

async function checkHealth() {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log(`✔ AI 서버 헬스체크 정상 (상태: ${data.status}, 업타임: ${data.uptime}s)\n`);
    return true;
  } catch (err) {
    console.error(`❌ AI 서버에 연결할 수 없습니다 (${BASE_URL}): ${err.message}`);
    console.error('👉 백엔드 AI 서버를 먼저 실행해주세요: pnpm run start:ai:dev\n');
    return false;
  }
}

async function testSingleChat() {
  console.log('--- [테스트 1] 단발성 대화 API (POST /api/v1/ai/chat) ---');
  const payload = {
    messages: [{ role: 'user', content: inputText }],
    provider: 'gemini',
    enableTools: false, // 단순 대화 테스트이므로 도구 비활성화
  };

  const startTime = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/v1/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Remote-User': 'local-admin',
      },
      body: JSON.stringify(payload),
    });

    const elapsed = Date.now() - startTime;
    const body = await res.json();

    if (!res.ok) {
      console.error(`❌ 응답 실패 (HTTP ${res.status}, ${elapsed}ms):`);
      console.error(JSON.stringify(body, null, 2));
      if (body.detail?.includes('API_KEY_INVALID') || body.message?.includes('API key not valid')) {
        console.warn('\n⚠️ [원인 분석] .env.ai 파일의 GEMINI_API_KEY가 유효하지 않습니다.');
        console.warn('   Google AI Studio(https://aistudio.google.com/)에서 새 API 키를 발급받아 등록해주세요.\n');
      }
      return false;
    }

    console.log(`✔ 응답 성공 (HTTP ${res.status}, ${elapsed}ms)`);
    console.log(`🤖 AI 답변: ${body.message?.content}`);
    if (body.toolExecutions?.length > 0) {
      console.log(`🔧 실행된 도구: ${body.toolExecutions.map((t) => t.name).join(', ')}`);
    }
    console.log('');
    return true;
  } catch (err) {
    console.error(`❌ 단발성 대화 요청 에러: ${err.message}\n`);
    return false;
  }
}

async function testStreamChat() {
  console.log('--- [테스트 2] 실시간 SSE 스트리밍 API (POST /api/v1/ai/chat/stream) ---');
  const payload = {
    messages: [{ role: 'user', content: inputText }],
    provider: 'gemini',
    enableTools: false,
  };

  const startTime = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/v1/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Remote-User': 'local-admin',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`❌ 스트리밍 연결 실패 (HTTP ${res.status}): ${errBody}`);
      return false;
    }

    console.log(`✔ SSE 스트림 연결 성공 (HTTP 200), 실시간 토큰 수신 시작:`);
    process.stdout.write('🤖 AI 스트림 출력: ');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const block of lines) {
        if (!block.trim() || block.startsWith(':')) continue;

        let eventType = 'message';
        let dataStr = '';

        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            dataStr = line.slice(6).trim();
          }
        }

        if (eventType === 'token' && dataStr) {
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.delta) {
              process.stdout.write(parsed.delta);
            }
          } catch {
            process.stdout.write(dataStr);
          }
        } else if (eventType === 'tool_start') {
          process.stdout.write(`\n[🔧 도구 실행 시작: ${dataStr}]\n`);
        } else if (eventType === 'tool_end') {
          process.stdout.write(`\n[✔ 도구 실행 완료: ${dataStr}]\n`);
        } else if (eventType === 'done') {
          process.stdout.write('\n✔ 스트리밍 완료 (done)\n');
        } else if (eventType === 'error') {
          process.stdout.write(`\n❌ 스트리밍 오류 발생: ${dataStr}\n`);
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`⏱ 총 소요 시간: ${elapsed}ms\n`);
    return true;
  } catch (err) {
    console.error(`\n❌ 스트리밍 요청 중 오류: ${err.message}\n`);
    return false;
  }
}

async function run() {
  const isHealthy = await checkHealth();
  if (!isHealthy) return;

  await testSingleChat();
  await testStreamChat();

  console.log('='.repeat(60));
  console.log('🎉 AI API 테스트 완료');
  console.log('='.repeat(60));
}

run();
