import fs from 'fs';
import config from '../config';
import db from '../data/db';
import { normalizeUid } from '../utils/uid';
import { Category, Figure } from '../types';

interface FigureRow {
  uid: string;
  name: string;
  category: Category;
  description: string;
}

const countStmt = db.prepare('SELECT COUNT(*) as count FROM figures');
const upsertStmt = db.prepare(`
  INSERT INTO figures (uid, name, category, description, created_at)
  VALUES (@uid, @name, @category, @description, @createdAt)
  ON CONFLICT(uid) DO UPDATE SET name = excluded.name, category = excluded.category, description = excluded.description
`);
const getStmt = db.prepare('SELECT uid, name, category, description FROM figures WHERE uid = ?');
const listStmt = db.prepare('SELECT uid, name, category, description FROM figures ORDER BY created_at ASC');
const deleteStmt = db.prepare('DELETE FROM figures WHERE uid = ?');

// one-time seed from the bundled starter deck (server/src/data/figures.json) - after this,
// the DB (not the JSON file) is the source of truth, so figures added via the UI survive redeploys
function seedIfEmpty(): void {
  const { count } = countStmt.get() as { count: number };
  if (count > 0) return;

  const raw = fs.readFileSync(config.figuresPath, 'utf8');
  const parsed: Record<string, { name: string; category: Category; description: string }> = JSON.parse(raw);
  const createdAt = new Date().toISOString();

  const insertAll = db.transaction(() => {
    for (const [uid, figure] of Object.entries(parsed)) {
      upsertStmt.run({
        uid: normalizeUid(uid),
        name: figure.name,
        category: figure.category,
        description: figure.description,
        createdAt,
      });
    }
  });
  insertAll();
}

seedIfEmpty();

export function resolveFigure(rawUid: string): Figure | null {
  const uid = normalizeUid(rawUid);
  const row = getStmt.get(uid) as FigureRow | undefined;
  return row ? { ...row } : null;
}

export function listFigures(): Figure[] {
  return listStmt.all() as Figure[];
}

export interface CreateFigureInput {
  uid: string;
  name: string;
  category: Category;
  description?: string;
}

export function createFigure(input: CreateFigureInput): Figure {
  const uid = normalizeUid(input.uid);
  upsertStmt.run({
    uid,
    name: input.name.trim(),
    category: input.category,
    description: (input.description || '').trim(),
    createdAt: new Date().toISOString(),
  });
  return resolveFigure(uid) as Figure;
}

export function deleteFigure(rawUid: string): boolean {
  const uid = normalizeUid(rawUid);
  const result = deleteStmt.run(uid);
  return result.changes > 0;
}
