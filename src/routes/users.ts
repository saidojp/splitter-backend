import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../config/prisma.js";
import { getDefaultAvatarUrl } from "../config/app.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Public user info and profile avatar management
 */

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get public user profile by numeric id
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: User profile
 *       404:
 *         description: User not found
 */
router.get("/:id", async (req, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ error: "Invalid id" });
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        uniqueId: true,
        avatarUrl: true,
      },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      uniqueId: user.uniqueId,
      avatarUrl: user.avatarUrl ?? getDefaultAvatarUrl(),
    });
  } catch (err) {
    console.error("GET /users/:id error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /users/me/avatar:
 *   patch:
 *     summary: Update current user's avatar URL
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [avatarUrl]
 *             properties:
 *               avatarUrl:
 *                 type: string
 *                 example: https://cdn.example.com/avatars/u1.png
 *     responses:
 *       200:
 *         description: Avatar updated
 */
router.patch(
  "/me/avatar",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const avatarUrlRaw = req.body?.avatarUrl;
      const avatarUrl =
        typeof avatarUrlRaw === "string" ? avatarUrlRaw.trim() : "";
      if (!avatarUrl)
        return res.status(400).json({ error: "avatarUrl is required" });

      // Strict URL validation: http/https and common image extensions
      try {
        const u = new URL(avatarUrl);
        if (!/^https?:$/.test(u.protocol)) throw new Error("bad");
        const pathname = (u.pathname || "").toLowerCase();
        const isImg = /(\.png|\.jpg|\.jpeg|\.webp|\.gif)(\?|#|$)/.test(
          pathname
        );
        if (!isImg) throw new Error("bad");
      } catch {
        return res.status(400).json({ error: "Invalid avatarUrl" });
      }

      const updated = await prisma.user.update({
        where: { id: req.user.id },
        data: { avatarUrl },
        select: { id: true },
      });
      console.log("/users/me/avatar updated:", { id: updated.id });
      return res.json({ success: true, avatarUrl });
    } catch (err) {
      console.error("PATCH /users/me/avatar error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /users/me/avatar:
 *   delete:
 *     summary: Reset current user's avatar to default (sets DB to null)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Avatar reset
 */
router.delete(
  "/me/avatar",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const updated = await prisma.user.update({
        where: { id: req.user.id },
        data: { avatarUrl: null },
        select: { id: true },
      });
      console.log("/users/me/avatar reset:", { id: updated.id });
      return res.json({ success: true, avatarUrl: getDefaultAvatarUrl() });
    } catch (err) {
      console.error("DELETE /users/me/avatar error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
