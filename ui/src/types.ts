export type Category = 'character' | 'location' | 'mood' | 'object';
export type StoryStatus = 'collecting' | 'generated';
export type StoryLength = 'short' | 'medium' | 'long';

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
  title: string | null;
  storyText: string | null;
  createdAt: string;
  generatedAt: string | null;
  favorite: boolean;
  figures: StoryFigureEntry[];
  // URLs of the story's saved illustrations, in story order (null: that scene couldn't be drawn).
  // Absent for a story without pictures, or while they are still rendering
  images?: (string | null)[];
  // true while the illustrations are still rendering server-side - the client polls
  // GET /stories/:id/images for them
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
  // the story's opening illustration, sized for the history list - null when it has none
  coverUrl: string | null;
}

export interface AddFigureResult {
  recognized: boolean;
  duplicate?: boolean;
  figure?: Figure;
  figures?: StoryFigureEntry[];
}
