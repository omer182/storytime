import fs from 'fs';
import config from '../config';
import { normalizeUid } from '../utils/uid';
import { Category, Figure } from '../types';

interface RawFigure {
  name: string;
  category: Category;
  description: string;
}

let cache: Record<string, RawFigure> | null = null;

export function loadFigures(): Record<string, RawFigure> {
  const raw = fs.readFileSync(config.figuresPath, 'utf8');
  const parsed: Record<string, RawFigure> = JSON.parse(raw);
  const normalized: Record<string, RawFigure> = {};
  for (const [uid, figure] of Object.entries(parsed)) {
    normalized[normalizeUid(uid)] = figure;
  }
  cache = normalized;
  return cache;
}

function getDeck(): Record<string, RawFigure> {
  if (!cache) loadFigures();
  return cache as Record<string, RawFigure>;
}

export function resolveFigure(rawUid: string): Figure | null {
  const uid = normalizeUid(rawUid);
  const deck = getDeck();
  const figure = deck[uid];
  if (!figure) return null;
  return { uid, ...figure };
}

export function listFigures(): Figure[] {
  const deck = getDeck();
  return Object.entries(deck).map(([uid, figure]) => ({ uid, ...figure }));
}
