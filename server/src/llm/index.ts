import config from '../config';
import * as anthropicProvider from './anthropicProvider';
import * as openaiProvider from './openaiProvider';
import * as mockProvider from './mockProvider';
import { LLMProvider } from '../types';

const PROVIDERS: Record<string, LLMProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  // returns a canned story with no network call - selected via LLM_PROVIDER=mock in tests
  mock: mockProvider,
};

export function getProvider(): LLMProvider {
  const provider = PROVIDERS[config.llmProvider];
  if (!provider) {
    throw new Error(`Unknown LLM_PROVIDER "${config.llmProvider}"`);
  }
  return provider;
}
