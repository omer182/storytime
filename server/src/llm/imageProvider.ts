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

// The image API moderates the *generated image* as well as the prompt (moderation_stage:
// "output"), and that check is non-deterministic - the same innocent picture-book prompt can
// pass on one call and trip on the next. So a block is retried as-is once, then once more with
// an explicit wholesomeness clause appended, before the scene is given up on.
const SAFETY_CLAUSE =
  ' Wholesome, innocent, age-appropriate for young children: fully clothed characters, ' +
  'friendly expressions, no violence, no scary imagery.';

function isModerationBlocked(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'moderation_blocked';
}

async function requestImage(prompt: string): Promise<string> {
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
  return `data:image/png;base64,${b64}`;
}

// Returns null rather than throwing: one blocked scene shouldn't cost the reader the other two.
async function generateImage(prompt: string, index: number): Promise<string | null> {
  const start = Date.now();
  const attempts = [prompt, prompt, prompt + SAFETY_CLAUSE];

  for (let attempt = 0; attempt < attempts.length; attempt++) {
    try {
      const image = await requestImage(attempts[attempt]);
      logger.debug(
        { index, attempt, model: config.imageModel, durationMs: Date.now() - start },
        'illustration generated'
      );
      return image;
    } catch (err) {
      const blocked = isModerationBlocked(err);
      const lastAttempt = attempt === attempts.length - 1;
      if (blocked && !lastAttempt) {
        logger.warn(
          { index, attempt, model: config.imageModel },
          'illustration blocked by the safety system, retrying'
        );
        continue;
      }
      logger.error(
        { err, index, attempt, blocked, model: config.imageModel, durationMs: Date.now() - start },
        'illustration generation failed'
      );
      return null;
    }
  }
  return null;
}

// One entry per scene, in scene order. A null means that scene's illustration couldn't be
// produced - callers keep the positions so the surviving images still land in the right places.
export async function generateStoryImages(
  storyText: string,
  figures: StoryFigureEntry[]
): Promise<(string | null)[]> {
  const scenePrompts = await writeScenePrompts(storyText, figures);
  return Promise.all(scenePrompts.map((prompt, index) => generateImage(prompt, index)));
}
