import type { FastifyBaseLogger } from 'fastify';
import type { IncomingHttpHeaders } from 'node:http';
import OpenAI from 'openai';

export type ProviderModelDescriptor = OpenAI.Models.Model;

export type ProviderContext = {
  headers: IncomingHttpHeaders;
  requestId: string;
  signal: AbortSignal;
  logger: FastifyBaseLogger;
};

export type ProviderAdapter = {
  name: string;
  modelPrefix: string;
  listModels(context: ProviderContext): Promise<ProviderModelDescriptor[]>;
  createChatCompletion(
    request: OpenAI.Chat.ChatCompletionCreateParams,
    context: ProviderContext,
  ): Promise<OpenAI.Chat.ChatCompletion>;
  streamChatCompletion(
    request: OpenAI.Chat.ChatCompletionCreateParams,
    context: ProviderContext,
  ): AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
};
