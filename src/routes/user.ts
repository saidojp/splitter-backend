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
          select: {
            id: true,
            email: true,
            username: true,
            uniqueId: true,
            avatarUrl: true,
          },
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
 * /user/username:
 *   patch:
 *     summary: Update username
 *     description: Change only the username of the current user.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username:
 *                 type: string
 *                 example: NewName
 *     responses:
 *       200:
 *         description: Username updated
 *       400:
 *         description: Invalid username
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.patch(
  "/username",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { username } = req.body ?? {};
      if (typeof username !== "string") {
        return res.status(400).json({ error: "Username must be a string" });
      }
      const clean = username.trim();
      if (!clean || clean.length < 2 || clean.length > 32) {
        return res
          .status(400)
          .json({ error: "Username must be 2-32 characters" });
      }

      const updated = await prisma.user
        .update({
          where: { id: req.user.id },
          data: { username: clean },
          select: {
            id: true,
            email: true,
            username: true,
            uniqueId: true,
            avatarUrl: true,
          },
        })
        .catch((e) => {
          if ((e as any)?.code === "P2025") return null;
          throw e;
        });

      if (!updated) return res.status(404).json({ error: "User not found" });
      return res.json(updated);
    } catch (err) {
      console.error("/user/username error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /user/email:
 *   patch:
 *     summary: Update email
 *     description: Change only the email of the current user.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 example: new@example.com
 *     responses:
 *       200:
 *         description: Email updated
 *       400:
 *         description: Invalid email
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       409:
 *         description: Email already in use
 */
router.patch(
  "/email",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { email } = req.body ?? {};
      if (typeof email !== "string") {
        return res.status(400).json({ error: "Email must be a string" });
      }
      const clean = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!clean || !emailRegex.test(clean)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      try {
        const updated = await prisma.user.update({
          where: { id: req.user.id },
          data: { email: clean },
          select: {
            id: true,
            email: true,
            username: true,
            uniqueId: true,
            avatarUrl: true,
          },
        });
        return res.json(updated);
      } catch (e: any) {
        if (e?.code === "P2002") {
          return res.status(409).json({ error: "Email already in use" });
        }
        if (e?.code === "P2025") {
          return res.status(404).json({ error: "User not found" });
        }
        throw e;
      }
    } catch (err) {
      console.error("/user/email error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /user/password:
 *   patch:
 *     summary: Update password
 *     description: Change password by providing the current password and a new one.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 example: oldPass123
 *               newPassword:
 *                 type: string
 *                 example: newStrongPassword123
 *     responses:
 *       200:
 *         description: Password updated
 *       400:
 *         description: Invalid input or wrong current password
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.patch(
  "/password",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { currentPassword, newPassword } = req.body ?? {};
      if (
        typeof currentPassword !== "string" ||
        typeof newPassword !== "string"
      ) {
        return res
          .status(400)
          .json({ error: "Both currentPassword and newPassword are required" });
      }
      if (newPassword.length < 6) {
        return res
          .status(400)
          .json({ error: "New password must be at least 6 characters" });
      }

      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const ok = await bcrypt.compare(currentPassword, user.password);
      if (!ok) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }

      const hashed = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id: req.user.id },
        data: { password: hashed },
      });

      return res.json({ success: true });
    } catch (err) {
      console.error("/user/password error:", err);
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
        select: {
          id: true,
          email: true,
          username: true,
          uniqueId: true,
          avatarUrl: true,
        },
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
