import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type { IncomingHttpHeaders } from 'node:http';
import OpenAI from 'openai';
import {
  chatCompletionsRequestSchema,
  type SupportedChatCompletionRequest,
} from './openai/schemas.js';
import {
  OpenAIProxyError,
  formatErrorResponse,
  isFastifyValidationError,
} from './openai/errors.js';
import { writeChatCompletionStream } from './openai/sse.js';
import { createProviderContext, listModels, resolveProvider } from './providers/registry.js';
import './providers/dummy.js';

type ModelListResponse = {
  object: 'list';
  data: OpenAI.Models.Model[];
};

function toOpenAIRequest(
  request: SupportedChatCompletionRequest,
): OpenAI.Chat.ChatCompletionCreateParams {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = request.messages.map((message) => {
    switch (message.role) {
      case 'system':
        return { role: 'system', content: message.content };
      case 'assistant':
        return { role: 'assistant', content: message.content };
      case 'user':
        return { role: 'user', content: message.content };
    }
  });

  const base = {
    model: request.model,
    messages,
  };

  const withOptionalFields = {
    ...base,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.top_p !== undefined ? { top_p: request.top_p } : {}),
    ...(request.max_tokens !== undefined ? { max_tokens: request.max_tokens } : {}),
    ...(request.max_completion_tokens !== undefined
      ? { max_completion_tokens: request.max_completion_tokens }
      : {}),
    ...(request.stop !== undefined ? { stop: request.stop } : {}),
    ...(request.user !== undefined ? { user: request.user } : {}),
  };

  if (request.stream) {
    return {
      ...withOptionalFields,
      stream: true,
    };
  }

  return withOptionalFields;
}

function createAbortSignal(request: FastifyRequest): AbortSignal {
  const controller = new AbortController();

  request.raw.on('close', () => {
    if (request.raw.aborted) {
      controller.abort();
    }
  });

  return controller.signal;
}

function sendError(reply: FastifyReply, error: unknown): void {
  const proxyError =
    error instanceof OpenAIProxyError
      ? error
      : new OpenAIProxyError(500, 'internal_server_error', 'Unexpected proxy error.');

  reply.status(proxyError.statusCode).send(formatErrorResponse(proxyError));
}

export function buildServer(logger?: FastifyBaseLogger): FastifyInstance {
  const app = Fastify({
    ajv: {
      customOptions: {
        allErrors: true,
        allowUnionTypes: true,
        removeAdditional: false,
      },
    },
    logger:
      logger ??
      {
        level: process.env.LOG_LEVEL ?? 'info',
      },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (isFastifyValidationError(error)) {
      const details = error.validation
        ?.map((issue) => issue.message)
        .filter(Boolean)
        .join('; ');

      sendError(
        reply,
        new OpenAIProxyError(
          400,
          'invalid_request_error',
          details ? `Request validation failed: ${details}` : 'Request validation failed.',
        ),
      );
      return;
    }

    request.log.error(error, 'request failed');
    sendError(reply, error);
  });

  app.get('/v1/models', async (request, reply) => {
    const context = createProviderContext({
      headers: request.headers,
      requestId: request.id,
      signal: createAbortSignal(request),
      logger: request.log,
    });

    const response: ModelListResponse = {
      object: 'list',
      data: await listModels(context),
    };

    reply.send(response);
  });

  app.post<{ Body: SupportedChatCompletionRequest }>(
    '/v1/chat/completions',
    {
      schema: {
        body: chatCompletionsRequestSchema,
      },
    },
    async (request, reply) => {
      const input = toOpenAIRequest(request.body);
      const context = createProviderContext({
        headers: request.headers as IncomingHttpHeaders,
        requestId: request.id,
        signal: createAbortSignal(request),
        logger: request.log,
      });
      const provider = resolveProvider(input.model);

      if (request.body.stream) {
        const stream = provider.streamChatCompletion(input, context);
        await writeChatCompletionStream(reply, stream);
        return reply;
      }

      const completion = await provider.createChatCompletion(input, context);
      reply.send(completion);
      return reply;
    },
  );

  app.get('/healthz', async () => ({ ok: true }));

  return app;
}
