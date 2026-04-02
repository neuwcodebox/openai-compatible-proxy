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

test('unsupported top-level field is rejected by request schema', async () => {
  const app = createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'dummy/echo-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
    },
  });

  expect(response.statusCode).toBe(400);
  const payload = response.json();
  expect(payload.error.type).toBe('invalid_request_error');
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
