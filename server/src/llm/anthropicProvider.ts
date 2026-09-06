import Anthropic from '@anthropic-ai/sdk';
import config from '../config';
import logger from '../logger';
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

export async function generateStory({ system, user, maxTokens }: LLMPrompt): Promise<string> {
  const start = Date.now();
  try {
    const response = await getClient().messages.create({
      model: config.llmModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    logger.debug(
      { model: config.llmModel, durationMs: Date.now() - start, usage: response.usage },
      'anthropic messages.create succeeded'
    );
    return text;
  } catch (err) {
    logger.error(
      { err, model: config.llmModel, durationMs: Date.now() - start },
      'anthropic messages.create failed'
    );
    throw err;
  }
}
