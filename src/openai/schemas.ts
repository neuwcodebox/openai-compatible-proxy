export type SupportedMessageRole = 'system' | 'user' | 'assistant';

export type SupportedChatMessage = {
  role: SupportedMessageRole;
  content: string;
};

export type SupportedChatCompletionRequest = {
  model: string;
  messages: SupportedChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string | string[];
  user?: string;
};

export const chatCompletionsRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['model', 'messages'],
  properties: {
    model: { type: 'string', minLength: 1 },
    stream: { type: 'boolean' },
    temperature: { type: 'number' },
    top_p: { type: 'number' },
    max_tokens: { type: 'integer', minimum: 1 },
    max_completion_tokens: { type: 'integer', minimum: 1 },
    stop: {
      anyOf: [
        { type: 'string' },
        {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
      ],
    },
    user: { type: 'string' },
    messages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'content'],
        properties: {
          role: {
            type: 'string',
            enum: ['system', 'user', 'assistant'],
          },
          content: {
            type: 'string',
            minLength: 1,
          },
        },
      },
    },
  },
} as const;
