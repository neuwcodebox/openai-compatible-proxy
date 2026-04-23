import OpenAI from 'openai';
import type {
  SupportedAssistantMessage,
  SupportedChatCompletionRequest,
  SupportedToolMessage,
} from './schemas.js';

const TOOL_CALL_MARKER = '[tool-call]';
const TOOL_RESULT_MARKER = '[tool-result]';

export type EmulatedToolCall = {
  name: string;
  arguments: Record<string, unknown>;
  tool_call_id?: string;
};

function flattenContent(content: string | Array<{ type: 'text'; text: string }>): string {
  if (typeof content === 'string') {
    return content;
  }

  return content.map((part) => part.text).join('\n');
}

function formatToolResultAsUserMessage(message: SupportedToolMessage): OpenAI.Chat.ChatCompletionUserMessageParam {
  const body = JSON.stringify(
    {
      tool_call_id: message.tool_call_id,
      content: message.content,
    },
    null,
    2,
  );

  return {
    role: 'user',
    content: [TOOL_RESULT_MARKER, body].join('\n'),
  };
}

function formatAssistantToolCallsAsAssistantMessage(
  message: SupportedAssistantMessage,
): OpenAI.Chat.ChatCompletionAssistantMessageParam | null {
  if (!message.tool_calls || message.tool_calls.length === 0) {
    return null;
  }

  const normalized = message.tool_calls.map((toolCall) => ({
    tool_call_id: toolCall.id,
    name: toolCall.function.name,
    arguments: parseJsonString(toolCall.function.arguments) ?? toolCall.function.arguments,
  }));
  const body = JSON.stringify(normalized, null, 2);

  return {
    role: 'assistant',
    content: [TOOL_CALL_MARKER, body].join('\n'),
  };
}

function parseJsonString(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildToolEmulationInstruction(request: SupportedChatCompletionRequest): string {
  const tools = request.tools ?? [];
  const toolChoice = request.tool_choice ?? 'auto';
  const prettyTools = JSON.stringify(tools, null, 2);
  const prettyToolChoice = JSON.stringify(toolChoice, null, 2);

  return [
    'You can either answer normally in plain text, or request a tool call using JSON.',
    `When you need a tool, start your response with "${TOOL_CALL_MARKER}" and then output a JSON body.`,
    'Tool-call JSON body shape:',
    '{"tool_call_id":"<optional_id>","name":"<tool_name>","arguments":{...}}',
    'History format is normalized as:',
    `${TOOL_CALL_MARKER} + JSON body for assistant tool-call records, and`,
    `${TOOL_RESULT_MARKER} + JSON body for user tool-result records.`,
    `When you receive a user message prefixed by ${TOOL_RESULT_MARKER}, you may either:`,
    '1) call another tool (if more data is needed), or',
    '2) answer normally in plain text.',
    'Do not wrap tool_call JSON with markdown fences.',
    'If no tool is needed, return a normal plain-text assistant answer.',
    'tool_choice:',
    prettyToolChoice,
    'tools:',
    prettyTools,
  ].join('\n');
}

function createToolCallId(): string {
  return `call_emulated_${Math.random().toString(36).slice(2, 12)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseEmulatedToolCallBody(value: unknown): EmulatedToolCall | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.name !== 'string' || value.name.length === 0 || !isRecord(value.arguments)) {
    return null;
  }

  const toolCallId =
    typeof value.tool_call_id === 'string' && value.tool_call_id.length > 0 ? value.tool_call_id : undefined;

  return {
    name: value.name,
    arguments: value.arguments,
    ...(toolCallId ? { tool_call_id: toolCallId } : {}),
  };
}

export function parseToolEmulationContent(content: string): EmulatedToolCall | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith(TOOL_CALL_MARKER)) {
    return null;
  }

  const body = trimmed.slice(TOOL_CALL_MARKER.length).trimStart();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return null;
  }

  if (Array.isArray(parsedJson)) {
    return parseEmulatedToolCallBody(parsedJson[0]);
  }

  return parseEmulatedToolCallBody(parsedJson);
}

export function shouldEmulateTools(
  request: SupportedChatCompletionRequest,
  providerSupportsNativeToolCalling: boolean,
): boolean {
  return Boolean(request.tools && request.tools.length > 0 && !providerSupportsNativeToolCalling);
}

export function toProviderMessages(
  request: SupportedChatCompletionRequest,
  emulateTools: boolean,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const converted = request.messages.flatMap((message): OpenAI.Chat.ChatCompletionMessageParam[] => {
    if (!emulateTools) {
      if (message.role === 'tool') {
        return [
          {
            role: 'tool',
            content: message.content,
            tool_call_id: message.tool_call_id,
          },
        ];
      }

      if (message.role === 'assistant') {
        return [
          {
            role: 'assistant',
            content: flattenContent(message.content),
            ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
          },
        ];
      }

      return [
        {
          role: message.role,
          content: flattenContent(message.content),
        },
      ];
    }

    if (message.role === 'tool') {
      return [formatToolResultAsUserMessage(message)];
    }

    if (message.role === 'assistant') {
      const assistantToolCalls = formatAssistantToolCallsAsAssistantMessage(message);
      if (assistantToolCalls) {
        return [assistantToolCalls];
      }

      return [
        {
          role: 'assistant',
          content: flattenContent(message.content),
        },
      ];
    }

    return [
      {
        role: message.role,
        content: flattenContent(message.content),
      },
    ];
  });

  if (!emulateTools) {
    return converted;
  }

  const systemContents = converted.flatMap((message) => {
    if (message.role !== 'system' || typeof message.content !== 'string') {
      return [];
    }

    return [message.content];
  });

  const nonSystemMessages = converted.filter((message) => message.role !== 'system');
  const injectedSections =
    systemContents.length > 0
      ? [
          '[System prompt]',
          systemContents.join('\n\n'),
          '---',
          '[Additional system instructions]',
          buildToolEmulationInstruction(request),
        ]
      : ['[Additional system instructions]', buildToolEmulationInstruction(request)];

  return [
    {
      role: 'system',
      content: injectedSections.join('\n\n'),
    },
    ...nonSystemMessages,
  ];
}

export function applyToolEmulationResponse(completion: OpenAI.Chat.ChatCompletion, emulateTools: boolean): OpenAI.Chat.ChatCompletion {
  if (!emulateTools) {
    return completion;
  }

  const firstChoice = completion.choices[0];
  if (!firstChoice) {
    return completion;
  }

  const content = firstChoice.message.content;

  if (typeof content !== 'string') {
    return completion;
  }

  const parsed = parseToolEmulationContent(content);

  if (!parsed) {
    return completion;
  }

  const cloned = structuredClone(completion);
  const clonedFirstChoice = cloned.choices[0];
  if (!clonedFirstChoice) {
    return completion;
  }

  clonedFirstChoice.message.content = null;
  clonedFirstChoice.message.tool_calls = [
    {
      id: parsed.tool_call_id ?? createToolCallId(),
      type: 'function',
      function: {
        name: parsed.name,
        arguments: JSON.stringify(parsed.arguments),
      },
    },
  ];
  clonedFirstChoice.finish_reason = 'tool_calls';

  return cloned;
}

function buildToolCallStreamChunk(
  template: OpenAI.Chat.ChatCompletionChunk,
  name: string,
  argumentsJson: string,
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: template.id,
    object: 'chat.completion.chunk',
    created: template.created,
    model: template.model,
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: createToolCallId(),
              type: 'function',
              function: {
                name,
                arguments: argumentsJson,
              },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  };
}

function buildFinalContentStreamChunk(
  template: OpenAI.Chat.ChatCompletionChunk,
  content: string,
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: template.id,
    object: 'chat.completion.chunk',
    created: template.created,
    model: template.model,
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          content,
        },
        finish_reason: null,
      },
    ],
  };
}

function buildStreamFinishChunk(
  template: OpenAI.Chat.ChatCompletionChunk,
  finishReason: 'stop' | 'tool_calls',
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: template.id,
    object: 'chat.completion.chunk',
    created: template.created,
    model: template.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
    ...(template.usage ? { usage: template.usage } : {}),
  };
}

export async function* transformToolEmulationStream(
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
  detectionWindowChars = 240,
): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  const buffered: OpenAI.Chat.ChatCompletionChunk[] = [];
  let bufferedText = '';
  let passthrough = false;
  let lastChunk: OpenAI.Chat.ChatCompletionChunk | null = null;

  for await (const chunk of stream) {
    if (passthrough) {
      yield chunk;
      continue;
    }

    lastChunk = chunk;
    buffered.push(chunk);
    const content = chunk.choices[0]?.delta.content;
    if (typeof content === 'string') {
      bufferedText += content;
    }

    const trimmed = bufferedText.trimStart();
    const looksLikeToolCallEnvelope = trimmed.length === 0 || trimmed.startsWith(TOOL_CALL_MARKER);
    const isFinalChunk = chunk.choices[0]?.finish_reason !== null && chunk.choices[0]?.finish_reason !== undefined;

    if (
      !looksLikeToolCallEnvelope ||
      (trimmed.length >= detectionWindowChars && !trimmed.startsWith(TOOL_CALL_MARKER))
    ) {
      passthrough = true;
      for (const bufferedChunk of buffered) {
        yield bufferedChunk;
      }
      buffered.length = 0;
      continue;
    }

    if (!isFinalChunk) {
      continue;
    }

    const parsed = parseToolEmulationContent(bufferedText);
    if (!parsed) {
      for (const bufferedChunk of buffered) {
        yield bufferedChunk;
      }
      return;
    }

    yield buildToolCallStreamChunk(chunk, parsed.name, JSON.stringify(parsed.arguments));
    yield buildStreamFinishChunk(chunk, 'tool_calls');
    return;
  }

  if (passthrough || buffered.length === 0) {
    return;
  }

  const parsed = parseToolEmulationContent(bufferedText);
  if (!parsed || !lastChunk) {
    for (const bufferedChunk of buffered) {
      yield bufferedChunk;
    }
    return;
  }

  yield buildToolCallStreamChunk(lastChunk, parsed.name, JSON.stringify(parsed.arguments));
  yield buildStreamFinishChunk(lastChunk, 'tool_calls');
}
