import OpenAI from 'openai';
import config from '../config';
import logger from '../logger';
import { LLMPrompt } from '../types';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

export async function generateStory({ system, user }: LLMPrompt): Promise<string> {
  const start = Date.now();
  try {
    const response = await getClient().chat.completions.create({
      model: config.llmModel,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const text = (response.choices[0]?.message?.content || '').trim();
    logger.debug(
      { model: config.llmModel, durationMs: Date.now() - start, usage: response.usage },
      'openai chat.completions.create succeeded'
    );
    return text;
  } catch (err) {
    logger.error(
      { err, model: config.llmModel, durationMs: Date.now() - start },
      'openai chat.completions.create failed'
    );
    throw err;
  }
}
