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

// only used if the scene writer skips its 4th line - see writeScenePrompts
const GENERIC_FALLBACK_PROMPT =
  'A wide, peaceful establishing view of a warm, magical storybook landscape. No people, no ' +
  `animals, no characters of any kind - only the empty landscape and its scenery. ${ART_STYLE}`;

const SCENE_SYSTEM_PROMPT = `You write image-generation prompts for a children's picture book, based on a story you are given.

You will receive the full story text (in Hebrew) and the list of characters/places/mood/objects it was built from.

Output exactly 4 lines, one prompt per line, no numbering, no blank lines, no extra commentary:
1. A scene from the OPENING of the story.
2. A scene from the MIDDLE of the story - a key moment where something happens.
3. A scene from the ENDING of the story.
4. A fallback used only if one of the first three can't be drawn: a wide establishing view of the story's main setting with NO characters in it - no people, no animals, no creatures of any kind, only the empty landscape and its scenery.

Rules, all mandatory:
- Every prompt must be written in English.
- Only depict characters, creatures, and settings that literally appear in the given story and cast list. Never invent a new character (especially never add a human child or narrator who isn't in the story) and never omit a character who should be in that scene.
- Never name a real-world franchise character (superhero, comic-book, or animation-studio characters) and never describe one recognizably. When the cast contains one, depict an ORIGINAL character in the same role instead: keep the archetype (a mighty green-skinned giant, a brave masked night-hero, a small woodland fawn) but change the signature look - different costume colors, different garments, no trademark emblem, mask shape, or silhouette. A reader must not be able to name the original character.
- Every time a character appears (in any of the 3 prompts), describe their concrete visual appearance the same way (species, coloring, notable features/outfit) so they look like the same character in all 3 images - don't just say "the lion", spell out what makes it recognizable.
- Absolutely no text, letters, words, numbers, speech bubbles, signs, or writing of any kind anywhere in the image.
- Each prompt must end with exactly this style instruction, verbatim: "${ART_STYLE}"`;

interface ScenePrompts {
  scenes: string[];
  // characters-free view of the setting, in English like the rest - the last rung of generateImage
  fallback: string;
}

async function writeScenePrompts(
  storyText: string,
  figures: StoryFigureEntry[]
): Promise<ScenePrompts> {
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
    .slice(0, 4);

  // the 4th line is a safety net, so a writer that returns only the 3 scenes is still usable
  if (prompts.length < 3) {
    logger.error({ raw, durationMs: Date.now() - start }, 'scene prompt writer returned an unexpected number of lines');
    throw new Error(`expected 3 scene prompts, got ${prompts.length}`);
  }
  const fallback = prompts[3] || GENERIC_FALLBACK_PROMPT;
  logger.debug({ prompts, durationMs: Date.now() - start }, 'scene prompts written');
  return { scenes: prompts.slice(0, 3), fallback };
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

// The illustrations travel to the phone inline in the JSON response as base64, so encoding
// dominates the payload: the same 1024px picture is ~2.4MB as base64 PNG and ~165KB as base64
// WebP q75. At the size these are actually displayed (a ~355px-wide column, so ~1024px on a 3x
// screen) the two are indistinguishable, so PNG only ever cost bandwidth.
const IMAGE_FORMAT = 'webp';
const IMAGE_COMPRESSION = 75;

async function requestImage(prompt: string): Promise<string> {
  const res = await getClient().images.generate({
    model: config.imageModel,
    prompt,
    // 1024x1024 is the smallest the gpt-image models offer (256/512 are dall-e-2 only)
    size: '1024x1024',
    quality: config.imageQuality,
    output_format: IMAGE_FORMAT,
    output_compression: IMAGE_COMPRESSION,
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('image generation returned no data');
  }
  return `data:image/${IMAGE_FORMAT};base64,${b64}`;
}

const DEBRAND_SYSTEM_PROMPT = `You rewrite children's-book image prompts that an image model refused to draw.

The refusal is almost always because the scene depicts a recognizable copyrighted or trademarked character.

Rewrite the prompt so that every character is unmistakably ORIGINAL: keep the scene, setting, action, mood and the same number of characters, but replace any franchise name with a plain descriptive one and change each borrowed costume - different colors, different garments, no trademark emblem, mask shape, or silhouette.

Output only the rewritten prompt, on one line, with no commentary.`;

async function debrandPrompt(prompt: string): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 500,
    messages: [
      { role: 'system', content: DEBRAND_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });
  const rewritten = res.choices[0]?.message?.content?.trim();
  if (!rewritten) {
    throw new Error('de-branding rewrite returned nothing');
  }
  return rewritten;
}

// Returns null rather than throwing: one blocked scene shouldn't cost the reader the other two.
// `fallbackPrompt` is the last resort - an empty establishing shot of the setting with no
// characters in it at all, which leaves the safety system nothing to object to.
async function generateImage(
  prompt: string,
  index: number,
  fallbackPrompt: string
): Promise<string | null> {
  const start = Date.now();
  // Each rung is tried only if the one before it was blocked: the same prompt again (the output
  // check is non-deterministic), then a wholesomeness nudge, then an LLM rewrite that strips out
  // the borrowed characters, then the characters-free setting shot.
  const attempts: (() => Promise<string>)[] = [
    () => Promise.resolve(prompt),
    () => Promise.resolve(prompt),
    () => Promise.resolve(prompt + SAFETY_CLAUSE),
    () => debrandPrompt(prompt),
    () => Promise.resolve(fallbackPrompt),
  ];

  for (let attempt = 0; attempt < attempts.length; attempt++) {
    try {
      const image = await requestImage(await attempts[attempt]());
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
  figures: StoryFigureEntry[],
  onScene?: (index: number, image: string | null) => void
): Promise<(string | null)[]> {
  const { scenes, fallback } = await writeScenePrompts(storyText, figures);
  return Promise.all(
    scenes.map(async (prompt, index) => {
      const image = await generateImage(prompt, index, fallback);
      // reported as each scene lands, so a reader can be shown the first picture while a scene
      // that needed retries is still rendering
      onScene?.(index, image);
      return image;
    })
  );
}
