import { afterEach, expect, test } from 'vitest';
import { buildServer } from '../src/server.js';

const apps = new Set<ReturnType<typeof buildServer>>();

afterEach(async () => {
  await Promise.all(
    Array.from(apps).map(async (app) => {
      apps.delete(app);
      await app.close();
    }),
  );
});

function createApp() {
  const app = buildServer();
  apps.add(app);
  return app;
}

test('GET /v1/models returns dummy models in OpenAI format', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'GET',
    url: '/v1/models',
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.object).toBe('list');
  expect(payload.data.map((model: { id: string }) => model.id).sort()).toEqual([
    'dummy/echo-1',
    'dummy/story-1',
  ]);
});

test('POST /v1/chat/completions returns non-streaming completion', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      messages: [{ role: 'user', content: 'hello proxy' }],
    },
    headers: {
      authorization: 'Bearer secret',
      'x-dummy-tag': 'tutorial',
    },
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.object).toBe('chat.completion');
  expect(payload.model).toBe('dummy/echo-1');
  expect(payload.choices[0].message.content).toMatch(/hello proxy/);
  expect(payload.choices[0].message.content).toMatch(/x-dummy-tag=tutorial/);
  expect(payload.choices[0].message.content).toMatch(/authorization_forwarded=true/);
});

test('POST /v1/chat/completions accepts text content parts from OpenAI clients', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'proxy' },
          ],
        },
      ],
    },
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.object).toBe('chat.completion');
  expect(payload.choices[0].message.content).toMatch(/hello\nproxy/);
});

test('POST /v1/chat/completions streams SSE chunks and [DONE]', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/story-1',
      stream: true,
      messages: [{ role: 'user', content: 'tell a short tale' }],
    },
    headers: {
      'x-dummy-tag': 'stream-test',
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type'] ?? '').toMatch(/^text\/event-stream/);
  expect(response.body).toMatch(/data: \{"id":"chatcmpl_dummy_/);
  expect(response.body).toMatch(/"object":"chat\.completion\.chunk"/);
  expect(response.body).toMatch(/stream-test/);
  expect(response.body).toMatch(/data: \[DONE\]/);
});

test('POST /v1/chat/completions streams with text content parts from OpenAI clients', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      stream: true,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'dd' }],
        },
      ],
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type'] ?? '').toMatch(/^text\/event-stream/);
  expect(response.body).toMatch(/"content":"Dummy"/);
  expect(response.body).toMatch(/\\"dd\\"/);
  expect(response.body).toMatch(/data: \[DONE\]/);
});

test('unknown provider prefix returns OpenAI-style not found error', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'unknown/model-1',
      messages: [{ role: 'user', content: 'hello' }],
    },
  });

  expect(response.statusCode).toBe(404);
  const payload = response.json();
  expect(payload.error.type).toBe('not_found_error');
  expect(payload.error.code).toBe('provider_not_found');
});

test('unsupported non-text message content shape is rejected by request schema', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'https://example.com/image.png',
              },
            },
          ],
        },
      ],
    },
  });

  expect(response.statusCode).toBe(400);
  const payload = response.json();
  expect(payload.error.type).toBe('invalid_request_error');
});

test('invalid tools field is rejected by request schema', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [
        {
          type: 'function',
        },
      ],
    },
  });

  expect(response.statusCode).toBe(400);
  const payload = response.json();
  expect(payload.error.type).toBe('invalid_request_error');
});

test('tool emulation returns OpenAI tool_calls for providers without native support', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      messages: [{ role: 'user', content: '서울 날씨 알려줘' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup_weather',
            description: 'Lookup weather',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
          },
        },
      ],
      tool_choice: 'auto',
    },
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.choices[0].finish_reason).toBe('tool_calls');
  expect(payload.choices[0].message.content).toBeNull();
  expect(payload.choices[0].message.tool_calls[0].function.name).toBe('lookup_weather');
});

test('tool emulation allows normal plain-text response when no tool call is needed', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      messages: [{ role: 'user', content: 'plain-text-only: 그냥 설명해줘' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup_weather',
          },
        },
      ],
      tool_choice: 'auto',
    },
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.choices[0].message.content).toMatch(/Plain text answer from dummy emulation mode/);
  expect(payload.choices[0].message.tool_calls).toBeUndefined();
});

test('tool result messages are transformed to user text for emulation providers', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      messages: [
        { role: 'user', content: '서울 날씨 알려줘' },
        {
          role: 'assistant',
          content: '도구 호출 중',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'lookup_weather',
                arguments: '{\"query\":\"서울 날씨\"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '맑음 20도',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup_weather',
          },
        },
      ],
    },
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.choices[0].message.content).toMatch(/Dummy finalized response from tool result/);
  expect(payload.choices[0].message.content).toMatch(/\[tool-result\]/);
});

test('tool emulation stream buffers and emits tool_calls instead of raw JSON tokens', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      stream: true,
      messages: [{ role: 'user', content: '서울 날씨 알려줘' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup_weather',
          },
        },
      ],
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type'] ?? '').toMatch(/^text\/event-stream/);
  expect(response.body).toMatch(/"tool_calls"/);
  expect(response.body).toMatch(/"finish_reason":"tool_calls"/);
  expect(response.body).not.toMatch(/"mode":"tool_call"/);
  expect(response.body).toMatch(/data: \[DONE\]/);
});

test('tool emulation stream with tool-result emits final text instead of protocol JSON', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      stream: true,
      messages: [
        { role: 'user', content: '서울 날씨 알려줘' },
        {
          role: 'assistant',
          content: '도구 호출 중',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'lookup_weather',
                arguments: '{\"query\":\"서울 날씨\"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '맑음 20도',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup_weather',
          },
        },
      ],
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type'] ?? '').toMatch(/^text\/event-stream/);
  expect(response.body).toMatch(/"content":"Dummy"/);
  expect(response.body).toMatch(/"content":"finalized"/);
  expect(response.body).toMatch(/"content":"tool"/);
  expect(response.body).toMatch(/"content":"result\."/);
  expect(response.body).not.toMatch(/"mode":"final"/);
  expect(response.body).toMatch(/data: \[DONE\]/);
});

test('tool emulation stream passes through plain text when response is not tool-call JSON', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      stream: true,
      messages: [{ role: 'user', content: 'plain-text-only: 일반 텍스트로 답해' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup_weather',
          },
        },
      ],
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type'] ?? '').toMatch(/^text\/event-stream/);
  expect(response.body).toMatch(/"content":"Plain"/);
  expect(response.body).toMatch(/"content":"text"/);
  expect(response.body).toMatch(/"content":"answer"/);
  expect(response.body).not.toMatch(/"tool_calls"/);
  expect(response.body).toMatch(/data: \[DONE\]/);
});

test('provider errors are mapped to OpenAI-style JSON errors', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      messages: [{ role: 'user', content: 'hello' }],
    },
    headers: {
      'x-dummy-fail': 'true',
    },
  });

  expect(response.statusCode).toBe(502);
  const payload = response.json();
  expect(payload.error.code).toBe('dummy_upstream_failed');
});
