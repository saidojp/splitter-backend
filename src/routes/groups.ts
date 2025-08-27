import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../config/prisma.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Groups
 *   description: Group management (create, list, members)
 */

/** Helper: check if user is owner of group */
async function isGroupOwner(groupId: number, userId: number) {
  const g = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ownerId: true },
  });
  return g?.ownerId === userId;
}

/**
 * @swagger
 * /groups:
 *   post:
 *     summary: Create a group
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Group created
 */
router.post("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "Name is required" });

    const group = await prisma.group.create({
      data: { name, ownerId: req.user.id },
    });

    // Add owner as ADMIN member
    await prisma.groupMember
      .create({
        data: { groupId: group.id, userId: req.user.id, role: "ADMIN" },
      })
      .catch(() => {});

    console.log("/groups create:", { id: group.id, ownerId: req.user.id });
    return res.json(group);
  } catch (err) {
    console.error("POST /groups error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /groups:
 *   get:
 *     summary: List groups for current user
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Groups list
 */
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;
    const groups = await prisma.group.findMany({
      where: {
        OR: [{ ownerId: me }, { members: { some: { userId: me } } }],
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        createdAt: true,
        _count: { select: { members: true, sessions: true } },
      },
      orderBy: { id: "asc" },
    });
    return res.json(groups);
  } catch (err) {
    console.error("GET /groups error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /groups/{groupId}:
 *   patch:
 *     summary: Rename group (owner only)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Group updated
 */
router.patch(
  "/:groupId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const groupId = Number(req.params.groupId);
      if (!Number.isFinite(groupId))
        return res.status(400).json({ error: "Invalid groupId" });
      const name =
        typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name) return res.status(400).json({ error: "Name is required" });
      if (!(await isGroupOwner(groupId, req.user.id)))
        return res.status(403).json({ error: "Forbidden" });

      const updated = await prisma.group.update({
        where: { id: groupId },
        data: { name },
      });
      console.log("/groups rename:", { id: groupId });
      return res.json(updated);
    } catch (err) {
      console.error("PATCH /groups/:groupId error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /groups/{groupId}:
 *   delete:
 *     summary: Delete group (owner only)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Group deleted
 */
router.delete(
  "/:groupId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const groupId = Number(req.params.groupId);
      if (!Number.isFinite(groupId))
        return res.status(400).json({ error: "Invalid groupId" });
      if (!(await isGroupOwner(groupId, req.user.id)))
        return res.status(403).json({ error: "Forbidden" });

      // Remove members first due to FK RESTRICT; sessions will get groupId set to NULL.
      await prisma.groupMember.deleteMany({ where: { groupId } });
      await prisma.group.delete({ where: { id: groupId } });
      console.log("/groups delete:", { id: groupId });
      return res.json({ success: true });
    } catch (err) {
      console.error("DELETE /groups/:groupId error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /groups/{groupId}/members:
 *   post:
 *     summary: Add member by uniqueId (owner only)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [uniqueId]
 *             properties:
 *               uniqueId:
 *                 type: string
 *                 example: "#1234"
 *     responses:
 *       200:
 *         description: Member added
 */
router.post(
  "/:groupId/members",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const groupId = Number(req.params.groupId);
      if (!Number.isFinite(groupId))
        return res.status(400).json({ error: "Invalid groupId" });
      if (!(await isGroupOwner(groupId, req.user.id)))
        return res.status(403).json({ error: "Forbidden" });

      // Correctly parse unique ID as a string to avoid JSON errors.
      const uniqueId =
        typeof req.body?.uniqueId === "string" ? req.body.uniqueId.trim() : "";
      if (!uniqueId)
        return res.status(400).json({ error: "uniqueId is required" });

      const user = await prisma.user.findUnique({
        where: { uniqueId },
        select: { id: true },
      });
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.id === req.user.id) {
        // owner already added below but avoid duplicate error for adding self
        const exists = await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId, userId: user.id } },
        });
        if (exists) return res.json({ success: true, alreadyMember: true });
      }

      const created = await prisma.groupMember
        .create({ data: { groupId, userId: user.id, role: "MEMBER" } })
        .catch((e: any) => {
          if (e?.code === "P2002") return null; // duplicate
          throw e;
        });
      if (!created) return res.status(409).json({ error: "Already a member" });
      console.log("/groups add member:", { groupId, userId: user.id });
      return res.json({ success: true });
    } catch (err) {
      console.error("POST /groups/:groupId/members error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /groups/{groupId}/members/{uniqueId}:
 *   delete:
 *     summary: Remove member by uniqueId (owner or self)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         schema:
 *           type: integer
 *         required: true
 *       - in: path
 *         name: uniqueId
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: Member removed
 */
router.delete(
  "/:groupId/members/:uniqueId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const groupId = Number(req.params.groupId);
      if (!Number.isFinite(groupId))
        return res.status(400).json({ error: "Invalid groupId" });
      const uniqueId = String(req.params.uniqueId || "").trim();
      if (!uniqueId) return res.status(400).json({ error: "Invalid uniqueId" });

      const user = await prisma.user.findUnique({
        where: { uniqueId },
        select: { id: true },
      });
      if (!user) return res.json({ success: true, removed: false });

      const owner = await prisma.group.findUnique({
        where: { id: groupId },
        select: { ownerId: true },
      });
      if (!owner) return res.status(404).json({ error: "Group not found" });
      const isOwner = owner.ownerId === req.user.id;
      const isSelf = user.id === req.user.id;
      if (!isOwner && !isSelf)
        return res.status(403).json({ error: "Forbidden" });
      if (user.id === owner.ownerId)
        return res.status(400).json({ error: "Cannot remove the group owner" });

      const member = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: user.id } },
      });
      if (!member) return res.json({ success: true, removed: false });

      await prisma.groupMember.delete({
        where: { groupId_userId: { groupId, userId: user.id } },
      });
      console.log("/groups remove member:", { groupId, userId: user.id });
      return res.json({ success: true, removed: true });
    } catch (err) {
      console.error("DELETE /groups/:groupId/members/:uniqueId error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
