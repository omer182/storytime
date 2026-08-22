export type Category = 'character' | 'location' | 'mood' | 'object';
export type StoryStatus = 'collecting' | 'generated';

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

export interface Story {
  id: string;
  status: StoryStatus;
  storyText: string | null;
  createdAt: string;
  generatedAt: string | null;
  figures: StoryFigureEntry[];
  // only present right after generating - never persisted, so a later GET won't have them
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

export interface ScanResult {
  recognized: boolean;
  duplicate?: boolean;
  led?: string;
  figure?: Figure;
  figures?: StoryFigureEntry[];
}
