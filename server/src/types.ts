export type Category = 'character' | 'location' | 'mood' | 'object';

export interface Figure {
  uid: string;
  name: string;
  category: Category;
  description: string;
}

export interface StoryFigureEntry {
  uid: string;
  name: string;
  category: Category;
  addedAt: string;
  entryId: number;
  // looked up from the figures table at generation time, not stored per story - it tells the
  // storyteller and the illustrator what a figure actually looks like (notably "חדר הילדים",
  // which is a real room and should be drawn as that room rather than a generic bedroom)
  description?: string;
}

export type StoryStatus = 'collecting' | 'generated';
export type StoryLength = 'short' | 'medium' | 'long';

export interface Story {
  id: string;
  status: StoryStatus;
  title: string | null;
  storyText: string | null;
  createdAt: string;
  generatedAt: string | null;
  favorite: boolean;
  figures: StoryFigureEntry[];
  // URLs of the persisted illustrations, in story order; null where a scene couldn't be drawn.
  // Absent when the story has no illustrations (or they are still rendering - see imagesPending)
  images?: (string | null)[];
  // set on the generate response when illustrations are still rendering - the client then polls
  // GET /api/stories/:id/images for them
  imagesPending?: boolean;
}

export interface StorySummary {
  id: string;
  status: StoryStatus;
  title: string | null;
  createdAt: string;
  generatedAt: string | null;
  favorite: boolean;
  figureCount: number;
  figures: { name: string; category: Category }[];
  snippet: string | null;
  coverUrl: string | null;
}

// what the stories.images column records: which scene files and whether a cover were saved
export interface StoryImagesRecord {
  scenes: boolean[];
  cover: boolean;
}

export interface LLMPrompt {
  system: string;
  user: string;
  // Hebrew is expensive to tokenize - measured at roughly 4-6 tokens per word - so the ceiling
  // has to scale with the requested length or it silently truncates the story mid-sentence
  maxTokens: number;
}

export interface LLMProvider {
  generateStory(prompt: LLMPrompt): Promise<string>;
}
