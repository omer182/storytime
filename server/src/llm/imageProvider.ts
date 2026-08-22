import OpenAI from 'openai';
import config from '../config';
import logger from '../logger';
import { StoryFigureEntry } from '../types';

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

// repeated verbatim in every scene prompt so the 3 images read as one consistent picture book,
// not 3 unrelated pieces of art
const ART_STYLE =
  'Disney/Pixar-style 2D animated children\'s book illustration. Warm, whimsical, soft rounded ' +
  'shapes, gentle vibrant colors, expressive friendly character faces. Not photorealistic.';

const SCENE_SYSTEM_PROMPT = `You write image-generation prompts for a children's picture book, based on a story you are given.

You will receive the full story text (in Hebrew) and the list of characters/places/mood/objects it was built from.

Output exactly 3 lines, one prompt per line, no numbering, no blank lines, no extra commentary:
1. A scene from the OPENING of the story.
2. A scene from the MIDDLE of the story - a key moment where something happens.
3. A scene from the ENDING of the story.

Rules, all mandatory:
- Every prompt must be written in English.
- Only depict characters, creatures, and settings that literally appear in the given story and cast list. Never invent a new character (especially never add a human child or narrator who isn't in the story) and never omit a character who should be in that scene.
- Every time a character appears (in any of the 3 prompts), describe their concrete visual appearance the same way (species, coloring, notable features/outfit) so they look like the same character in all 3 images - don't just say "the lion", spell out what makes it recognizable.
- Absolutely no text, letters, words, numbers, speech bubbles, signs, or writing of any kind anywhere in the image.
- Each prompt must end with exactly this style instruction, verbatim: "${ART_STYLE}"`;

async function writeScenePrompts(storyText: string, figures: StoryFigureEntry[]): Promise<string[]> {
  const castLines = figures.map((f) => `- ${f.name} (${f.category})`).join('\n');
  const userContent = `Cast:\n${castLines}\n\nStory:\n${storyText}`;

  const start = Date.now();
  const res = await getClient().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 700,
    messages: [
      { role: 'system', content: SCENE_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  });

  const raw = res.choices[0]?.message?.content?.trim() || '';
  const prompts = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (prompts.length !== 3) {
    logger.error({ raw, durationMs: Date.now() - start }, 'scene prompt writer returned an unexpected number of lines');
    throw new Error(`expected 3 scene prompts, got ${prompts.length}`);
  }
  logger.debug({ prompts, durationMs: Date.now() - start }, 'scene prompts written');
  return prompts;
}

async function generateImage(prompt: string, index: number): Promise<string> {
  const start = Date.now();
  try {
    const res = await getClient().images.generate({
      model: config.imageModel,
      prompt,
      size: '1024x1024',
      quality: 'medium',
      n: 1,
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error('image generation returned no data');
    }
    logger.debug({ index, model: config.imageModel, durationMs: Date.now() - start }, 'illustration generated');
    return `data:image/png;base64,${b64}`;
  } catch (err) {
    logger.error({ err, index, model: config.imageModel, durationMs: Date.now() - start }, 'illustration generation failed');
    throw err;
  }
}

export async function generateStoryImages(
  storyText: string,
  figures: StoryFigureEntry[]
): Promise<string[]> {
  const scenePrompts = await writeScenePrompts(storyText, figures);
  return Promise.all(scenePrompts.map((prompt, index) => generateImage(prompt, index)));
}
