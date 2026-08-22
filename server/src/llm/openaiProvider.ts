import OpenAI from 'openai';
import config from '../config';
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
  const response = await getClient().chat.completions.create({
    model: config.llmModel,
    max_tokens: 2000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  return (response.choices[0]?.message?.content || '').trim();
}
