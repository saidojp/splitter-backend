import { Router } from "express";
import type { Response } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../config/prisma.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: User
 *   description: User management
 */

/**
 * @swagger
 * /user/update:
 *   patch:
 *     summary: Update user profile (username or password)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 example: NewName
 *               password:
 *                 type: string
 *                 example: newStrongPassword123
 *     responses:
 *       200:
 *         description: User data updated
 *       400:
 *         description: No fields to update
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.patch(
  "/update",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { username, password } = req.body ?? {};
      if (!username && !password) {
        return res.status(400).json({ error: "Provide username or password" });
      }

      const data: Record<string, unknown> = {};
      if (typeof username === "string" && username.trim()) {
        data.username = username.trim();
      }
      if (typeof password === "string" && password) {
        data.password = await bcrypt.hash(password, 10);
      }

      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: "Invalid field values" });
      }

      const updated = await prisma.user
        .update({
          where: { id: req.user.id },
          data,
          select: { id: true, email: true, username: true, uniqueId: true },
        })
        .catch((e) => {
          if ((e as any)?.code === "P2025") return null; // Prisma: record not found
          throw e;
        });

      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }
      console.log("/user/update success:", { id: updated.id });
      return res.json(updated);
    } catch (err) {
      console.error("/user/update error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /user/delete:
 *   delete:
 *     summary: Delete user account
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.delete(
  "/delete",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const deleted = await prisma.user
        .delete({
          where: { id: req.user.id },
          select: { id: true },
        })
        .catch((e) => {
          if ((e as any)?.code === "P2025") return null; // record not found
          throw e;
        });

      if (!deleted) {
        return res.status(404).json({ error: "User not found" });
      }
      console.log("/user/delete success:", { id: req.user.id });
      return res.json({ success: true });
    } catch (err) {
      console.error("/user/delete error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /user/list:
 *   get:
 *     summary: List users (temporary)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Список пользователей
 */
router.get(
  "/list",
  authenticateToken,
  async (_req: AuthRequest, res: Response) => {
    try {
      const users = await prisma.user.findMany({
        select: { id: true, email: true, username: true, uniqueId: true },
        orderBy: { id: "asc" },
      });
      console.log("/user/list count:", users.length);
      return res.json(users);
    } catch (err) {
      console.error("/user/list error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
