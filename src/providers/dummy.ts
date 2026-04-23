import OpenAI from 'openai';
import { OpenAIProxyError } from '../openai/errors.js';
import { registerProvider } from './registry.js';
import type { ProviderAdapter, ProviderContext, ProviderModelDescriptor } from './types.js';

const DUMMY_MODELS = ['dummy/echo-1', 'dummy/story-1'] as const;

function unixTime(): number {
  return Math.floor(Date.now() / 1000);
}

function completionId(): string {
  return `chatcmpl_dummy_${Math.random().toString(36).slice(2, 12)}`;
}

function flattenTextContent(content: OpenAI.Chat.ChatCompletionMessageParam['content']): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const textParts = content.flatMap((part) => (part.type === 'text' ? [part.text] : []));
  return textParts.length > 0 ? textParts.join('\n') : null;
}

function getLastUserMessage(request: OpenAI.Chat.ChatCompletionCreateParams): string {
  const userMessage = [...request.messages]
    .reverse()
    .find((message): message is OpenAI.Chat.ChatCompletionUserMessageParam => message.role === 'user');

  if (!userMessage) {
    throw new OpenAIProxyError(
      400,
      'invalid_request_error',
      'At least one user message is required for the dummy provider.',
      'missing_user_message',
    );
  }

  const content = flattenTextContent(userMessage.content);

  if (content === null) {
    throw new OpenAIProxyError(
      400,
      'invalid_request_error',
      'Dummy provider only supports text message content.',
      'unsupported_message_content',
    );
  }

  return content;
}

function buildAssistantContent(
  request: OpenAI.Chat.ChatCompletionCreateParams,
  context: ProviderContext,
): string {
  const prompt = getLastUserMessage(request);
  const headerTag = typeof context.headers['x-dummy-tag'] === 'string' ? context.headers['x-dummy-tag'] : 'none';
  const authForwarded = Boolean(context.headers.authorization);

  if (context.headers['x-dummy-fail'] === 'true') {
    throw new OpenAIProxyError(502, 'server_error', 'Dummy provider failed on purpose.', 'dummy_upstream_failed');
  }

  const hasToolEmulationInstruction = request.messages.some(
    (message) =>
      message.role === 'system' &&
      typeof message.content === 'string' &&
      message.content.includes('request a tool call using JSON'),
  );

  if (hasToolEmulationInstruction) {
    if (prompt.includes('plain-text-only')) {
      return `Plain text answer from dummy emulation mode: ${prompt}`;
    }

    if (prompt.includes('[tool-result]')) {
      return `Dummy finalized response from tool result.\n${prompt}`;
    }

    return [
      '[tool-call]',
      JSON.stringify(
        {
          name: 'lookup_weather',
          arguments: {
            query: prompt,
          },
        },
        null,
        2,
      ),
    ].join('\n');
  }

  if (request.model === 'dummy/story-1') {
    return [
      `Dummy story mode received: "${prompt}".`,
      `A courier carried the request through the proxy with tag "${headerTag}".`,
      `Authorization header forwarded: ${authForwarded ? 'yes' : 'no'}.`,
      'The tale ends with a provider adapter that needs almost no glue code.',
    ].join(' ');
  }

  return [
    `Dummy echo mode received: "${prompt}".`,
    `x-dummy-tag=${headerTag}.`,
    `authorization_forwarded=${authForwarded}.`,
  ].join(' ');
}

function estimateUsage(content: string, prompt: string) {
  const promptTokens = Math.max(1, prompt.trim().split(/\s+/).length);
  const completionTokens = Math.max(1, content.trim().split(/\s+/).length);

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

function createCompletion(
  request: OpenAI.Chat.ChatCompletionCreateParams,
  context: ProviderContext,
): OpenAI.Chat.ChatCompletion {
  const prompt = getLastUserMessage(request);
  const content = buildAssistantContent(request, context);
  const created = unixTime();

  const completion: OpenAI.Chat.ChatCompletion = {
    id: completionId(),
    object: 'chat.completion',
    created,
    model: request.model,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: {
          role: 'assistant',
          content,
          refusal: null,
        },
      },
    ],
    usage: estimateUsage(content, prompt),
  };

  return completion;
}

async function* createStream(
  request: OpenAI.Chat.ChatCompletionCreateParams,
  context: ProviderContext,
): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  const content = buildAssistantContent(request, context);
  const prompt = getLastUserMessage(request);
  const id = completionId();
  const created = unixTime();
  const parts = content.split(/(\s+)/).filter(Boolean);

  const firstChunk: OpenAI.Chat.ChatCompletionChunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model: request.model,
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: '' },
        finish_reason: null,
      },
    ],
  };
  yield firstChunk;

  for (const part of parts) {
    const chunk: OpenAI.Chat.ChatCompletionChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model: request.model,
      choices: [
        {
          index: 0,
          delta: { content: part },
          finish_reason: null,
        },
      ],
    };

    yield chunk;
  }

  const finalChunk: OpenAI.Chat.ChatCompletionChunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model: request.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
      },
    ],
    usage: estimateUsage(content, prompt),
  };

  yield finalChunk;
}

const dummyProvider: ProviderAdapter = {
  name: 'dummy',
  modelPrefix: 'dummy',
  supportsNativeToolCalling: false,
  async listModels(_context): Promise<ProviderModelDescriptor[]> {
    const created = unixTime();

    return DUMMY_MODELS.map((modelId) => ({
      id: modelId,
      object: 'model',
      created,
      owned_by: 'dummy-provider',
    }));
  },
  async createChatCompletion(request, context) {
    return createCompletion(request, context);
  },
  streamChatCompletion(request, context) {
    return createStream(request, context);
  },
};

registerProvider(dummyProvider);
