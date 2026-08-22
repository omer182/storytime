import Anthropic from '@anthropic-ai/sdk';
import config from '../config';
import { LLMPrompt } from '../types';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

export async function generateStory({ system, user }: LLMPrompt): Promise<string> {
  const response = await getClient().messages.create({
    model: config.llmModel,
    max_tokens: 2000,
    system,
    messages: [{ role: 'user', content: user }],
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}
