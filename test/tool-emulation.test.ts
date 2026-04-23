import { expect, test } from 'vitest';
import { toProviderMessages } from '../src/openai/tool-emulation.js';
import type { SupportedChatCompletionRequest } from '../src/openai/schemas.js';

function baseRequest(): SupportedChatCompletionRequest {
  return {
    model: 'dummy/echo-1',
    messages: [
      { role: 'system', content: '너는 친절한 비서야.' },
      { role: 'user', content: '서울 날씨 알려줘' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'lookup_weather',
        },
      },
    ],
  };
}

test('emulation mode merges injected and client system instructions into one system message', () => {
  const messages = toProviderMessages(baseRequest(), true);

  const systemMessages = messages.filter((message) => message.role === 'system');
  expect(systemMessages).toHaveLength(1);
  expect(systemMessages[0]).toMatchObject({ role: 'system' });

  if (systemMessages[0]?.role !== 'system') {
    throw new Error('expected system message');
  }

  expect(systemMessages[0].content).toContain('[System prompt]');
  expect(systemMessages[0].content).toContain('---');
  expect(systemMessages[0].content).toContain('[Additional system instructions]');
  expect(systemMessages[0].content).toContain('너는 친절한 비서야.');
  expect(systemMessages[0].content.indexOf('[System prompt]')).toBeLessThan(
    systemMessages[0].content.indexOf('[Additional system instructions]'),
  );
});

test('non-emulation mode keeps original system messages untouched', () => {
  const messages = toProviderMessages(baseRequest(), false);

  const systemMessages = messages.filter((message) => message.role === 'system');
  expect(systemMessages).toHaveLength(1);
  if (systemMessages[0]?.role !== 'system') {
    throw new Error('expected system message');
  }

  expect(systemMessages[0].content).toBe('너는 친절한 비서야.');
});
