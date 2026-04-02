export type SupportedMessageRole = 'system' | 'user' | 'assistant';

export type SupportedTextContentPart = {
  type: 'text';
  text: string;
};

export type SupportedChatMessage = {
  role: SupportedMessageRole;
  content: string | SupportedTextContentPart[];
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
      type: ['string', 'array'],
      items: { type: 'string' },
      minItems: 1,
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
            type: ['string', 'array'],
            minLength: 1,
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'text'],
              properties: {
                type: { enum: ['text'] },
                text: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
    },
  },
} as const;
