import sharp from 'sharp';
import config from '../config';
import { StoryFigureEntry } from '../types';

// Offline stand-in for imageProvider in mock mode (LLM_PROVIDER=mock): solid-colour placeholder
// scenes made locally, no network call - so tests and local runs exercise the real
// persist -> serve -> history path. Scenes listed in MOCK_IMAGE_FAIL_SCENES come back null,
// the same way a scene blocked by the real provider does.
const SCENE_COLOURS = ['#d98a5c', '#5fa3bf', '#a374a8'];

export async function generateStoryImages(
  _storyText: string,
  _figures: StoryFigureEntry[],
  onScene?: (index: number, image: string | null) => void
): Promise<(string | null)[]> {
  return Promise.all(
    SCENE_COLOURS.map(async (background, index) => {
      let image: string | null = null;
      if (!config.mockImageFailScenes.includes(index)) {
        const webp = await sharp({ create: { width: 1024, height: 1024, channels: 3, background } })
          .webp({ quality: 75 })
          .toBuffer();
        image = `data:image/webp;base64,${webp.toString('base64')}`;
      }
      onScene?.(index, image);
      return image;
    })
  );
}
