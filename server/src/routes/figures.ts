import { Router, Request, Response } from 'express';
import * as figureService from '../services/figureService';

const router = Router();

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

export default router;
