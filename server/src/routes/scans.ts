import { Router, Request, Response } from 'express';
import * as scanFeed from '../services/scanFeed';
import * as figureService from '../services/figureService';

const router = Router();

/**
 * @openapi
 * /api/scans:
 *   post:
 *     summary: Report a raw NFC scan not tied to a story (used to enroll a new/unrecognized tag)
 *     tags: [Scans]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [uid]
 *             properties:
 *               uid: { type: string, example: "04A1B2C3" }
 *     responses:
 *       204: { description: Recorded }
 *       400: { description: Missing uid }
 */
router.post('/scans', (req: Request, res: Response) => {
  const { uid } = req.body || {};
  if (typeof uid !== 'string' || !uid.trim()) {
    return res.status(400).json({ error: 'uid is required' });
  }
  scanFeed.recordScan(uid);
  res.status(204).send();
});

/**
 * @openapi
 * /api/scans/latest:
 *   get:
 *     summary: >
 *       The most recent scan not yet attached to a known figure (polled by the "add figure" UI).
 *       Returns null once that uid has been registered via POST /api/figures, or if nothing has
 *       been scanned yet.
 *     tags: [Scans]
 *     responses:
 *       200:
 *         description: Pending scan, or null
 */
router.get('/scans/latest', (req: Request, res: Response) => {
  const scan = scanFeed.getLatestScan();
  if (!scan || figureService.resolveFigure(scan.uid)) {
    return res.json(null);
  }
  res.json(scan);
});

export default router;
