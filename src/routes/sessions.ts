import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../config/prisma.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import { getDefaultAvatarUrl } from "../config/app.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Sessions
 *   description: Receipt split sessions
 */

/**
 * @swagger
 * /sessions:
 *   post:
 *     summary: Create a session (optionally within a group)
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SessionCreateInput'
 *     responses:
 *       200:
 *         description: Session created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 */
/**
 * @swagger
 * components:
 *   schemas:
 *     SessionCreateInput:
 *       type: object
 *       properties:
 *         groupId:
 *           type: integer
 *           nullable: true
 *         serviceFee:
 *           type: number
 *           nullable: true
 *         total:
 *           type: number
 *           nullable: true
 */
router.post("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const groupId = req.body?.groupId;
    const serviceFee = Number(req.body?.serviceFee ?? 0);
    const total = Number(req.body?.total ?? 0);

    let groupCheck = null as null | {
      ownerId: number;
      members: { userId: number }[];
    };
    if (groupId != null) {
      const gid = Number(groupId);
      if (!Number.isFinite(gid))
        return res.status(400).json({ error: "Invalid groupId" });
      groupCheck = await prisma.group.findUnique({
        where: { id: gid },
        select: {
          ownerId: true,
          members: {
            where: { userId: req.user.id },
            select: { userId: true },
          },
        },
      });
      if (!groupCheck)
        return res.status(404).json({ error: "Group not found" });
      const isOwnerOrMember =
        groupCheck.ownerId === req.user.id ||
        (groupCheck.members?.length ?? 0) > 0;
      if (!isOwnerOrMember) return res.status(403).json({ error: "Forbidden" });
    }

    const created = await prisma.session.create({
      data: {
        creatorId: req.user.id,
        groupId: groupId != null ? Number(groupId) : null,
        serviceFee: serviceFee || 0,
        total: total || 0,
      },
    });
    console.log("/sessions create:", {
      id: created.id,
      groupId: created.groupId,
    });
    return res.json(created);
  } catch (err) {
    console.error("POST /sessions error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /sessions:
 *   get:
 *     summary: List sessions (by group or personal created)
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: groupId
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Sessions list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Session'
 */
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const groupId =
      req.query.groupId != null ? Number(req.query.groupId) : undefined;
    let where: { groupId?: number; creatorId?: number } = {};
    if (groupId && Number.isFinite(groupId)) {
      // Enforce group membership/ownership
      const grp = await prisma.group.findUnique({
        where: { id: groupId },
        select: {
          ownerId: true,
          members: { where: { userId: req.user.id }, select: { userId: true } },
        },
      });
      if (!grp) return res.status(404).json({ error: "Group not found" });
      const allowed =
        grp.ownerId === req.user.id || (grp.members?.length ?? 0) > 0;
      if (!allowed) return res.status(403).json({ error: "Forbidden" });
      where = { groupId };
    } else {
      where = { creatorId: req.user.id };
    }

    const sessions = await prisma.session.findMany({
      where,
      orderBy: { id: "desc" },
      select: {
        id: true,
        creatorId: true,
        groupId: true,
        total: true,
        serviceFee: true,
        status: true,
        createdAt: true,
      },
    });
    return res.json(sessions);
  } catch (err) {
    console.error("GET /sessions error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /sessions/{sessionId}:
 *   get:
 *     summary: Get detailed session with creator, group, participants and items
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Session detail
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionDetail'
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 */
router.get(
  "/:sessionId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const sessionId = Number(req.params.sessionId);
      if (!Number.isFinite(sessionId))
        return res.status(400).json({ error: "Invalid sessionId" });

      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          creatorId: true,
          groupId: true,
          receiptImageUrl: true,
          serviceFee: true,
          total: true,
          status: true,
          createdAt: true,
          creator: {
            select: {
              id: true,
              email: true,
              username: true,
              uniqueId: true,
              avatarUrl: true,
            },
          },
          group: { select: { id: true, name: true, ownerId: true } },
          participants: {
            select: {
              amountOwed: true,
              user: {
                select: {
                  id: true,
                  email: true,
                  username: true,
                  uniqueId: true,
                  avatarUrl: true,
                },
              },
            },
          },
          items: {
            select: {
              id: true,
              name: true,
              price: true,
              assignments: { select: { userId: true } },
            },
          },
        },
      });
      if (!session) return res.status(404).json({ error: "Session not found" });

      // Authorization: creator or group owner/member if group-scoped
      if (session.groupId != null) {
        const gid = session.group?.id;
        if (!gid) return res.status(404).json({ error: "Group not found" });
        const isOwner = session.group!.ownerId === req.user.id;
        if (!isOwner) {
          const membership = await prisma.groupMember.findUnique({
            where: { groupId_userId: { groupId: gid, userId: req.user.id } },
            select: { userId: true },
          });
          if (!membership) return res.status(403).json({ error: "Forbidden" });
        }
      } else {
        if (session.creatorId !== req.user.id)
          return res.status(403).json({ error: "Forbidden" });
      }

      const mapUser = (u: any) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        uniqueId: u.uniqueId,
        avatarUrl: u.avatarUrl ?? getDefaultAvatarUrl(),
      });

      const response = {
        id: session.id,
        creatorId: session.creatorId,
        groupId: session.groupId,
        receiptImageUrl: session.receiptImageUrl,
        serviceFee: session.serviceFee,
        total: session.total,
        status: session.status,
        createdAt: session.createdAt,
        creator: mapUser(session.creator),
        group: session.group
          ? { id: session.group.id, name: session.group.name }
          : null,
        participants: session.participants.map((p) => ({
          amountOwed: p.amountOwed,
          user: mapUser(p.user),
        })),
        items: session.items.map((it) => ({
          id: it.id,
          name: it.name,
          price: it.price,
          assignedUserIds: it.assignments.map((a) => a.userId),
        })),
      };

      return res.json(response);
    } catch (err) {
      console.error("GET /sessions/:sessionId error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /sessions/{sessionId}/close:
 *   patch:
 *     summary: Close a session (creator only)
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Session closed
 */
router.patch(
  "/:sessionId/close",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const sessionId = Number(req.params.sessionId);
      if (!Number.isFinite(sessionId))
        return res.status(400).json({ error: "Invalid sessionId" });
      const s = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { creatorId: true, status: true },
      });
      if (!s) return res.status(404).json({ error: "Session not found" });
      if (s.creatorId !== req.user.id)
        return res.status(403).json({ error: "Forbidden" });

      const updated = await prisma.session.update({
        where: { id: sessionId },
        data: { status: "CLOSED" },
      });
      console.log("/sessions close:", { id: sessionId });
      return res.json(updated);
    } catch (err) {
      console.error("PATCH /sessions/:sessionId/close error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
