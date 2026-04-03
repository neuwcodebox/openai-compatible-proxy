import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createAbortSignal } from '../src/server.js';

type MockIncoming = EventEmitter & {
  aborted: boolean;
  complete: boolean;
};

type MockResponse = EventEmitter & {
  writableEnded: boolean;
};

function createMockRequestReply() {
  const rawRequest = Object.assign(new EventEmitter(), {
    aborted: false,
    complete: true,
  }) as MockIncoming;
  const rawReply = Object.assign(new EventEmitter(), {
    writableEnded: false,
  }) as MockResponse;

  const request = { raw: rawRequest } as FastifyRequest;
  const reply = { raw: rawReply } as FastifyReply;

  return { rawRequest, rawReply, request, reply };
}

test('request close alone does not abort signal', () => {
  const { rawRequest, request, reply } = createMockRequestReply();

  const signal = createAbortSignal(request, reply);
  rawRequest.emit('close');

  expect(signal.aborted).toBe(false);
});

test('request aborted event aborts signal', () => {
  const { rawRequest, request, reply } = createMockRequestReply();

  const signal = createAbortSignal(request, reply);
  rawRequest.aborted = true;
  rawRequest.emit('aborted');

  expect(signal.aborted).toBe(true);
});

test('response close before finish aborts signal', () => {
  const { rawReply, request, reply } = createMockRequestReply();

  const signal = createAbortSignal(request, reply);
  rawReply.emit('close');

  expect(signal.aborted).toBe(true);
});

test('response close after finish does not abort signal', () => {
  const { rawReply, request, reply } = createMockRequestReply();

  const signal = createAbortSignal(request, reply);
  rawReply.writableEnded = true;
  rawReply.emit('finish');
  rawReply.emit('close');

  expect(signal.aborted).toBe(false);
});
