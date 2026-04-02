import type { ProviderAdapter, ProviderContext, ProviderModelDescriptor } from './types.js';
import { OpenAIProxyError } from '../openai/errors.js';

const providers = new Map<string, ProviderAdapter>();

export function registerProvider(adapter: ProviderAdapter): void {
  if (providers.has(adapter.modelPrefix)) {
    throw new Error(`Provider prefix "${adapter.modelPrefix}" is already registered.`);
  }

  providers.set(adapter.modelPrefix, adapter);
}

export function resolveProvider(model: string): ProviderAdapter {
  const modelPrefix = model.split('/')[0] ?? '';
  const provider = providers.get(modelPrefix);

  if (!provider) {
    throw new OpenAIProxyError(
      404,
      'not_found_error',
      `No provider registered for model "${model}". Expected a model name prefixed like "<provider>/<model-name>".`,
      'provider_not_found',
    );
  }

  return provider;
}

export async function listModels(context: ProviderContext): Promise<ProviderModelDescriptor[]> {
  const results = await Promise.all([...providers.values()].map((provider) => provider.listModels(context)));
  return results.flat();
}

export function createProviderContext(context: ProviderContext): ProviderContext {
  return context;
}
