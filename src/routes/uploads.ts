import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { authenticateToken } from "../middleware/auth.js";
import { uploadAvatarObject } from "../config/r2.js";
import { prisma } from "../config/prisma.js";

type UploadFile = {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};
// We rely on multer to inject req.file at runtime; keep a minimal local typing for safety
type ReqFileMinimal = { buffer: Buffer; mimetype: string; size: number };

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Uploads
 *   description: File uploads (avatars)
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.AVATAR_MAX_BYTES || 2 * 1024 * 1024), // default 2MB
  },
});

function pickExtByMime(
  mime: string
): ".webp" | ".jpg" | ".jpeg" | ".png" | ".gif" | null {
  const m = mime.toLowerCase();
  if (m === "image/webp") return ".webp";
  if (m === "image/jpeg") return ".jpg";
  if (m === "image/png") return ".png";
  if (m === "image/gif") return ".gif";
  return null;
}

/**
 * @swagger
 * /uploads/avatar:
 *   post:
 *     summary: Upload user avatar (multipart/form-data)
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar uploaded and saved
 */
router.post(
  "/avatar",
  authenticateToken,
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const file = (req as any).file as ReqFileMinimal | undefined;
      if (!file) {
        res.status(400).json({ error: "file is required" });
        return;
      }

      const { buffer, mimetype, size } = file;
      const maxBytes = Number(process.env.AVATAR_MAX_BYTES || 2 * 1024 * 1024);
      if (size > maxBytes) {
        res.status(413).json({ error: "File too large" });
        return;
      }

      const ext = pickExtByMime(mimetype);
      if (!ext) {
        res.status(400).json({ error: "Unsupported image type" });
        return;
      }

      // Build version from current timestamp seconds for simplicity
      const v = Math.floor(Date.now() / 1000);
      const key = `avatars/${req.user.id}/v${v}/avatar${ext}`;

      const put = await uploadAvatarObject(key, buffer, mimetype);

      // Persist URL to user
      await prisma.user.update({
        where: { id: req.user.id },
        data: { avatarUrl: put.url },
        select: { id: true },
      });

      res.json({ success: true, avatarUrl: put.url, key: put.key });
      return;
    } catch (err) {
      console.error("POST /uploads/avatar error:", err);
      res.status(500).json({ error: "Server error" });
      return;
    }
  }
);

export default router;
