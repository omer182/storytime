import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  port: number;
  llmProvider: string;
  llmModel: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  generateImages: boolean;
  imageModel: string;
  dbPath: string;
  figuresPath: string;
}

const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10) || 3000,
  llmProvider: process.env.LLM_PROVIDER || 'anthropic',
  llmModel: process.env.LLM_MODEL || 'claude-haiku-4-5-20251001',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  // illustrations always go through OpenAI's image API regardless of LLM_PROVIDER -
  // Claude has no image generation - so this only takes effect when OPENAI_API_KEY is set
  generateImages: (process.env.GENERATE_IMAGES ?? 'true') === 'true',
  imageModel: process.env.IMAGE_MODEL || 'gpt-image-1.5',
  // __dirname is server/src in dev (tsx runs .ts in place) and server/dist in prod
  // (tsc-compiled) - both are direct children of server/, so '..' always lands
  // back on server/ regardless of which mode is running.
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '..', 'data', 'stories.db'),
  figuresPath: process.env.FIGURES_PATH
    ? path.resolve(process.env.FIGURES_PATH)
    : path.join(__dirname, '..', 'src', 'data', 'figures.json'),
};

export default config;
