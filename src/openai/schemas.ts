export type SupportedMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type SupportedTextContentPart = {
  type: 'text';
  text: string;
};

export type SupportedChatMessage = {
  role: SupportedMessageRole;
  content: string | SupportedTextContentPart[];
  tool_call_id?: string;
};

export type SupportedToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type SupportedToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | {
      type: 'function';
      function: {
        name: string;
      };
    };

export type SupportedChatCompletionToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type SupportedAssistantMessage = {
  role: 'assistant';
  content: string | SupportedTextContentPart[];
  tool_calls?: SupportedChatCompletionToolCall[];
};

export type SupportedUserSystemMessage = {
  role: 'system' | 'user';
  content: string | SupportedTextContentPart[];
};

export type SupportedToolMessage = {
  role: 'tool';
  content: string;
  tool_call_id: string;
};

export type SupportedChatCompletionRequest = {
  model: string;
  messages: Array<SupportedAssistantMessage | SupportedToolMessage | SupportedUserSystemMessage>;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string | string[];
  user?: string;
  tools?: SupportedToolDefinition[];
  tool_choice?: SupportedToolChoice;
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
    tools: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'function'],
        properties: {
          type: { enum: ['function'] },
          function: {
            type: 'object',
            additionalProperties: false,
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 1 },
              description: { type: 'string' },
              parameters: { type: 'object' },
            },
          },
        },
      },
    },
    tool_choice: {
      anyOf: [
        { enum: ['none', 'auto', 'required'] },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'function'],
          properties: {
            type: { enum: ['function'] },
            function: {
              type: 'object',
              additionalProperties: false,
              required: ['name'],
              properties: {
                name: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      ],
    },
    messages: {
      type: 'array',
      minItems: 1,
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['role', 'content'],
            properties: {
              role: {
                enum: ['system', 'user'],
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
          {
            type: 'object',
            additionalProperties: false,
            required: ['role', 'content'],
            properties: {
              role: {
                enum: ['assistant'],
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
              tool_calls: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'type', 'function'],
                  properties: {
                    id: { type: 'string', minLength: 1 },
                    type: { enum: ['function'] },
                    function: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['name', 'arguments'],
                      properties: {
                        name: { type: 'string', minLength: 1 },
                        arguments: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['role', 'content', 'tool_call_id'],
            properties: {
              role: {
                enum: ['tool'],
              },
              content: {
                type: 'string',
                minLength: 1,
              },
              tool_call_id: {
                type: 'string',
                minLength: 1,
              },
            },
          },
        ],
      },
    },
  },
} as const;
