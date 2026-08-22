import { Router, Request, Response } from 'express';
import * as figureService from '../services/figureService';
import { Category } from '../types';

const router = Router();

const VALID_CATEGORIES: Category[] = ['character', 'location', 'mood', 'object'];

/**
 * @openapi
 * /api/figures:
 *   get:
 *     summary: List the full deck of known figures (NFC tokens)
 *     tags: [Figures]
 *     responses:
 *       200:
 *         description: The deck
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   uid: { type: string }
 *                   name: { type: string }
 *                   category: { type: string }
 *                   description: { type: string }
 */
router.get('/figures', (req: Request, res: Response) => {
  res.json(figureService.listFigures());
});

/**
 * @openapi
 * /api/figures:
 *   post:
 *     summary: Register a figure against a tag UID (or update an existing UID's details)
 *     tags: [Figures]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [uid, name, category]
 *             properties:
 *               uid: { type: string, example: "04A1B2C3" }
 *               name: { type: string }
 *               category: { type: string, enum: [character, location, mood, object] }
 *               description: { type: string }
 *     responses:
 *       201: { description: Created (or updated, if the uid already existed) }
 *       400: { description: Missing/invalid field }
 */
router.post('/figures', (req: Request, res: Response) => {
  const { uid, name, category, description } = req.body || {};

  if (typeof uid !== 'string' || !uid.trim()) {
    return res.status(400).json({ error: 'uid is required' });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
  }
  if (description !== undefined && typeof description !== 'string') {
    return res.status(400).json({ error: 'description must be a string' });
  }

  const figure = figureService.createFigure({ uid, name, category, description });
  res.status(201).json(figure);
});

/**
 * @openapi
 * /api/figures/{uid}:
 *   delete:
 *     summary: Remove a figure from the deck
 *     tags: [Figures]
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204: { description: Removed }
 *       404: { description: Not found }
 */
router.delete('/figures/:uid', (req: Request, res: Response) => {
  const removed = figureService.deleteFigure(req.params.uid);
  if (!removed) return res.status(404).json({ error: 'figure not found' });
  res.status(204).send();
});

export default router;
