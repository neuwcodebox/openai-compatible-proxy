# OpenAI Compatible Proxy Server

새 LLM provider를 최소한의 글루 코드만으로 OpenAI 호환 API 뒤에 붙이는 예제 서버입니다.  
초기 구현은 `GET /v1/models`, `POST /v1/chat/completions`만 지원하고, `chat.completions`는 일반 응답과 SSE 스트리밍 둘 다 제공합니다.

## 왜 이런 구조인가

- OpenAI 호환 HTTP 계층과 provider adapter 계층을 분리합니다.
- provider 선택은 `model` prefix로 결정합니다.
  - 예: `dummy/echo-1` -> `dummy` provider
- 프록시는 인증 헤더를 해석하지 않습니다.
  - 들어온 원본 헤더를 provider adapter에 그대로 넘깁니다.
  - 실제 비공개 provider를 붙일 때 adapter가 `authorization`, `x-api-key`, tenant header 등을 직접 사용하면 됩니다.
- 요청/응답 타입은 `openai` SDK 타입을 기준으로 맞추고, 런타임에서는 우리가 지원하는 subset만 엄격하게 검증합니다.

## 빠르게 실행

```bash
npm install
npm run dev
```

기본 포트는 `3000`입니다.

환경 변수:

- `PORT`: 서버 포트
- `HOST`: 바인드 주소, 기본값 `0.0.0.0`
- `LOG_LEVEL`: Fastify 로그 레벨

## Docker

이미지 빌드:

```bash
docker build -t openai-compatible-proxy .
```

컨테이너 실행:

```bash
docker run --rm -p 3000:3000 openai-compatible-proxy
```

환경 변수 지정:

```bash
docker run --rm -p 3000:3000 \
  -e PORT=3000 \
  -e LOG_LEVEL=info \
  openai-compatible-proxy
```

## API 예제

모델 목록:

```bash
curl http://localhost:3000/v1/models
```

일반 chat completion:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer upstream-secret' \
  -H 'x-dummy-tag: tutorial' \
  -d '{
    "model": "dummy/echo-1",
    "messages": [
      { "role": "user", "content": "hello proxy" }
    ]
  }'
```

스트리밍 chat completion:

```bash
curl http://localhost:3000/v1/chat/completions \
  -N \
  -H 'content-type: application/json' \
  -H 'x-dummy-tag: stream-demo' \
  -d '{
    "model": "dummy/story-1",
    "stream": true,
    "messages": [
      { "role": "user", "content": "tell a short tale" }
    ]
  }'
```

OpenAI client 스타일의 text part array도 지원:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "dummy/echo-1",
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "hello" },
          { "type": "text", "text": "proxy" }
        ]
      }
    ]
  }'
```

## 지원 범위

지원 필드:

- `model`
- `messages`
- `stream`
- `temperature`
- `top_p`
- `max_tokens`
- `max_completion_tokens`
- `stop`
- `user`

지원 메시지 형태:

- role: `system | user | assistant`
- content: 문자열 또는 `[{ "type": "text", "text": "..." }]` 형태의 text part array 지원

현재 제외:

- `tools`, `tool_choice`
- image/audio/file이 포함된 multimodal content array
- audio
- function calling
- structured outputs

제외한 필드는 `400 invalid_request_error`로 거절합니다.

## 구조

```text
src/
  index.ts
  server.ts
  openai/
    errors.ts
    schemas.ts
    sse.ts
  providers/
    types.ts
    registry.ts
    dummy.ts
test/
  server.test.ts
```

## 새 provider 추가하기

핵심은 adapter 하나를 만드는 것입니다.

1. `src/providers/<provider>.ts` 파일을 추가합니다.
2. `ProviderAdapter`를 구현합니다.
3. `registerProvider()`로 등록합니다.
4. 모델 이름을 `<provider>/<model>` 형식으로 노출합니다.

예시:

```ts
import OpenAI from 'openai';
import { registerProvider } from './registry.js';
import type { ProviderAdapter } from './types.js';

const myProvider: ProviderAdapter = {
  name: 'acme',
  modelPrefix: 'acme',
  async listModels(context) {
    const auth = context.headers.authorization;

    return [
      {
        id: 'acme/chat-1',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'acme',
      },
    ];
  },
  async createChatCompletion(request, context) {
    const auth = context.headers.authorization;
    const tenant = context.headers['x-tenant-id'];

    // 여기서 비공개 provider SDK 또는 HTTP 호출 수행
    const completion: OpenAI.Chat.ChatCompletion = {
      id: 'chatcmpl_example',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          logprobs: null,
          message: {
            role: 'assistant',
            content: `tenant=${tenant}, auth=${Boolean(auth)}`,
            refusal: null,
          },
        },
      ],
    };

    return completion;
  },
  async *streamChatCompletion(request, context) {
    yield {
      id: 'chatcmpl_example',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'hello' },
          finish_reason: null,
        },
      ],
    };
  },
};

registerProvider(myProvider);
```

포인트:

- provider 인증은 adapter 책임입니다.
- 프록시는 들어온 헤더를 그대로 `context.headers`에 담아 넘깁니다.
- 반환 타입은 `OpenAI.Chat.ChatCompletion`, `OpenAI.Chat.ChatCompletionChunk`를 그대로 쓰면 됩니다.
- 런타임 검증은 프록시 계층이 담당하므로 adapter는 이미 정제된 요청을 받습니다.

## 개발 명령

```bash
npm run dev
npm run build
npm test
```
