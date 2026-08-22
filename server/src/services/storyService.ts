import { randomUUID } from 'crypto';
import db from '../data/db';
import config from '../config';
import * as figureService from './figureService';
import { getProvider } from '../llm';
import { buildPrompt } from '../llm/promptBuilder';
import { generateStoryImages } from '../llm/imageProvider';
import { Category, Figure, Story, StoryFigureEntry, StorySummary, StoryStatus } from '../types';

const REQUIRED_CATEGORIES: Category[] = ['character', 'location', 'mood'];
const RECENT_HISTORY_LIMIT = 3;

interface StoryRow {
  id: string;
  status: StoryStatus;
  story_text: string | null;
  created_at: string;
  generated_at: string | null;
}

interface StoryFigureRow {
  id: number;
  story_id: string;
  uid: string;
  name: string;
  category: Category;
  added_at: string;
}

const insertStoryStmt = db.prepare('INSERT INTO stories (id, status, created_at) VALUES (?, ?, ?)');
const getStoryStmt = db.prepare('SELECT * FROM stories WHERE id = ?');
const listStoriesStmt = db.prepare(
  "SELECT * FROM stories WHERE status = 'generated' ORDER BY generated_at DESC"
);
const insertFigureStmt = db.prepare(
  'INSERT INTO story_figures (story_id, uid, name, category, added_at) VALUES (?, ?, ?, ?, ?)'
);
const listFiguresForStoryStmt = db.prepare(
  'SELECT * FROM story_figures WHERE story_id = ? ORDER BY added_at ASC'
);
const deleteFigureStmt = db.prepare('DELETE FROM story_figures WHERE id = ? AND story_id = ?');
const setGeneratedStmt = db.prepare(
  "UPDATE stories SET status = 'generated', story_text = ?, generated_at = ? WHERE id = ?"
);
const recentGeneratedStmt = db.prepare(
  "SELECT story_text FROM stories WHERE status = 'generated' ORDER BY generated_at DESC LIMIT ?"
);

function rowToStory(row: StoryRow, figures: StoryFigureRow[]): Story {
  return {
    id: row.id,
    status: row.status,
    storyText: row.story_text,
    createdAt: row.created_at,
    generatedAt: row.generated_at,
    figures: figures.map((f) => ({
      uid: f.uid,
      name: f.name,
      category: f.category,
      addedAt: f.added_at,
      entryId: f.id,
    })),
  };
}

export function createStory(): Story {
  const id = randomUUID();
  insertStoryStmt.run(id, 'collecting', new Date().toISOString());
  return getStory(id) as Story;
}

export function getStory(storyId: string): Story | null {
  const row = getStoryStmt.get(storyId) as StoryRow | undefined;
  if (!row) return null;
  const figures = listFiguresForStoryStmt.all(storyId) as StoryFigureRow[];
  return rowToStory(row, figures);
}

export function listStories(): StorySummary[] {
  const rows = listStoriesStmt.all() as StoryRow[];
  return rows.map((row) => {
    const figures = listFiguresForStoryStmt.all(row.id) as StoryFigureRow[];
    const story = rowToStory(row, figures);
    return {
      id: story.id,
      status: story.status,
      createdAt: story.createdAt,
      generatedAt: story.generatedAt,
      figureCount: story.figures.length,
      snippet: story.storyText ? story.storyText.slice(0, 120) : null,
    };
  });
}

const LED_UNKNOWN = 'red_wiggle';
const LED_DUPLICATE = 'blue_pulse';
const LED_NEW = 'green_pulse';

export interface ScanResult {
  notFound?: boolean;
  recognized?: boolean;
  duplicate?: boolean;
  led?: string;
  figure?: Figure;
  figures?: StoryFigureEntry[];
}

export function addFigure(storyId: string, rawUid: string): ScanResult {
  const story = getStoryStmt.get(storyId) as StoryRow | undefined;
  if (!story) return { notFound: true };

  const resolved = figureService.resolveFigure(rawUid);
  if (!resolved) {
    return { recognized: false, led: LED_UNKNOWN };
  }

  const existing = listFiguresForStoryStmt.all(storyId) as StoryFigureRow[];
  const duplicate = existing.some((f) => f.uid === resolved.uid);
  if (duplicate) {
    return {
      recognized: true,
      duplicate: true,
      led: LED_DUPLICATE,
      figure: resolved,
      figures: (getStory(storyId) as Story).figures,
    };
  }

  insertFigureStmt.run(storyId, resolved.uid, resolved.name, resolved.category, new Date().toISOString());

  return {
    recognized: true,
    duplicate: false,
    led: LED_NEW,
    figure: resolved,
    figures: (getStory(storyId) as Story).figures,
  };
}

export function removeFigure(storyId: string, entryId: string | number): boolean {
  const result = deleteFigureStmt.run(entryId, storyId);
  return result.changes > 0;
}

function missingRequiredCategories(figures: StoryFigureEntry[]): Category[] {
  const present = new Set(figures.map((f) => f.category));
  return REQUIRED_CATEGORIES.filter((cat) => !present.has(cat));
}

export interface GenerateResult {
  notFound?: boolean;
  validationError?: boolean;
  missing?: Category[];
}

export async function generateStory(storyId: string): Promise<Story | GenerateResult> {
  const story = getStory(storyId);
  if (!story) return { notFound: true };

  const missing = missingRequiredCategories(story.figures);
  if (missing.length > 0) {
    return { validationError: true, missing };
  }

  const recentRows = recentGeneratedStmt.all(RECENT_HISTORY_LIMIT) as { story_text: string | null }[];
  const recentHistory = recentRows.map((r) => r.story_text).filter((t): t is string => Boolean(t));

  const prompt = buildPrompt(story.figures, recentHistory);
  const provider = getProvider();
  const storyText = await provider.generateStory(prompt);

  const generatedAt = new Date().toISOString();
  setGeneratedStmt.run(storyText, generatedAt, storyId);

  const savedStory = getStory(storyId) as Story;

  // illustrations are generated fresh on every request and never persisted (not written to
  // the db, not saved to disk) - they only ever exist in this one response.
  // Skipped in mock mode (llmProvider === 'mock') so tests stay offline even though a real
  // OPENAI_API_KEY may be present in the environment.
  if (config.generateImages && config.openaiApiKey && config.llmProvider !== 'mock') {
    try {
      savedStory.images = await generateStoryImages(storyText, story.figures);
    } catch (err) {
      console.error('story image generation failed:', err);
    }
  }

  return savedStory;
}

export { REQUIRED_CATEGORIES };
