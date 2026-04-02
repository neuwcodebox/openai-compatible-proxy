import type { FastifyError } from 'fastify';

type OpenAIErrorBody = {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
};

export class OpenAIProxyError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly type: string,
    message: string,
    public readonly code: string | null = null,
    public readonly param: string | null = null,
  ) {
    super(message);
    this.name = 'OpenAIProxyError';
  }
}

export function formatErrorResponse(error: OpenAIProxyError): OpenAIErrorBody {
  return {
    error: {
      message: error.message,
      type: error.type,
      param: error.param,
      code: error.code,
    },
  };
}

export function isFastifyValidationError(error: FastifyError): boolean {
  return error.code === 'FST_ERR_VALIDATION' || Array.isArray(error.validation);
}
