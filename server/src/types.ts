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
}

export type StoryStatus = 'collecting' | 'generated';
export type StoryLength = 'short' | 'medium' | 'long';

export interface Story {
  id: string;
  status: StoryStatus;
  storyText: string | null;
  createdAt: string;
  generatedAt: string | null;
  figures: StoryFigureEntry[];
  // only present on the response to POST /stories/:id/generate - never persisted,
  // so a later GET of the same story won't have them
  images?: string[];
}

export interface StorySummary {
  id: string;
  status: StoryStatus;
  createdAt: string;
  generatedAt: string | null;
  figureCount: number;
  snippet: string | null;
}

export interface LLMPrompt {
  system: string;
  user: string;
}

export interface LLMProvider {
  generateStory(prompt: LLMPrompt): Promise<string>;
}
