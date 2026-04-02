import type { FastifyReply } from 'fastify';
import OpenAI from 'openai';

export async function writeChatCompletionStream(
  reply: FastifyReply,
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
): Promise<void> {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  try {
    for await (const chunk of stream) {
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    reply.raw.write('data: [DONE]\n\n');
  } finally {
    reply.raw.end();
  }
}
