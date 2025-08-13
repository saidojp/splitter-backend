import { Router } from "express";

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     description: サーバーを確認するためのエンドポイント
 *     responses:
 *       200:
 *         description: サーバーは正常に動作しています
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   example: 2025-08-13T12:34:56.789Z
 */
router.get("/", (_, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

export default router;
