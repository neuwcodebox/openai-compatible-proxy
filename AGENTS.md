# AGENTS.md

이 파일은 이 저장소에서 작업하는 코딩 에이전트를 위한 지속 규칙입니다.

## 프로젝트 개요

- 목적: pluggable provider를 OpenAI 호환 HTTP API 뒤에 붙이는 프록시 서버
- 런타임: Node.js 22+
- 언어/모듈: TypeScript + ESM (`"type": "module"`)
- 서버: Fastify
- 테스트: Vitest

## 자주 쓰는 명령

```bash
npm install
npm run dev
npm run build
npm test
```

빌드 출력은 `dist/`에 생성됩니다.

## 구조 요약

- `src/server.ts`: Fastify 라우트와 오류 처리
- `src/openai/`: 요청 스키마, SSE 출력, OpenAI 스타일 오류 포맷
- `src/providers/`: provider adapter 인터페이스, registry, provider 구현
- `test/server.test.ts`: 현재 HTTP 동작에 대한 회귀 테스트

## 작업 규칙

- OpenAI 호환 API는 "지원하는 subset만 엄격 검증"하는 방향을 유지합니다.
- API 지원 범위를 바꾸면 다음 셋을 함께 수정하세요.
  - `src/openai/schemas.ts`
  - provider 처리 로직
  - `test/server.test.ts`
  - `README.md`
- provider 선택은 반드시 `model` prefix 기반으로 유지합니다.
  - 예: `dummy/echo-1` -> `dummy`
- 프록시 계층은 인증 헤더를 해석하지 않습니다.
  - 들어온 헤더는 가능한 한 원본 그대로 provider에 전달합니다.
- 새 provider를 추가할 때는 `registerProvider()` 등록만으로 붙을 수 있게 유지하세요.
- TypeScript ESM 규칙을 지키세요.
  - 소스 내부 import 경로에는 `.js` 확장자를 사용합니다.
- 요청 스키마를 바꿀 때 Fastify/Ajv 동작까지 확인하세요.
  - plain Ajv에서 통과해도 Fastify validator에서 다르게 동작할 수 있습니다.
  - 현재 서버는 union type 검증을 위해 `allowUnionTypes: true`를 사용합니다.

## 현재 API 범위 메모

- 현재 핵심 엔드포인트는 `GET /v1/models`, `POST /v1/chat/completions`
- `messages[].content`는 다음만 지원합니다.
  - 문자열
  - text part array: `[{ "type": "text", "text": "..." }]`
- image/audio/file 등 비텍스트 multimodal part는 아직 지원하지 않습니다.

## 변경 전후 체크

- 작업 후 최소 `npm test`와 `npm run build`를 실행하세요.
- API 동작이나 지원 범위를 바꿨다면 README 예제도 최신 상태로 맞추세요.
