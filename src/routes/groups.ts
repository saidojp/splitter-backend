import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../config/prisma.js";
import jwt from "jsonwebtoken";
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
 *   get:
 *     summary: Get group participants (owner included as member with role=owner)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Group participants
 */
router.get(
  "/:groupId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const groupId = Number(req.params.groupId);
      if (!Number.isFinite(groupId))
        return res.status(400).json({ error: "Invalid groupId" });

      const group = await prisma.group.findUnique({
        where: { id: groupId },
        select: {
          id: true,
          name: true,
          ownerId: true,
          owner: { select: { id: true, username: true, uniqueId: true } },
          members: {
            orderBy: { joinedAt: "asc" },
            select: {
              userId: true,
              joinedAt: true,
              user: { select: { id: true, username: true, uniqueId: true } },
            },
          },
        },
      });
      if (!group) return res.status(404).json({ error: "Group not found" });

      const me = req.user.id;
      const isOwner = group.ownerId === me;
      const myMember = group.members.find((m) => m.userId === me) || null;
      if (!isOwner && !myMember)
        return res.status(403).json({ error: "Forbidden" });

      // Build members: owner first with role=owner, then all group members (excluding owner) with role=member
      const ownerEntry = {
        uniqueId: group.owner.uniqueId,
        username: group.owner.username,
        role: "owner" as const,
      };
      const memberEntries = group.members
        .filter((m) => m.userId !== group.ownerId)
        .map((m) => ({
          uniqueId: m.user.uniqueId,
          username: m.user.username,
          role: "member" as const,
        }));

      const role = isOwner ? ("owner" as const) : ("member" as const);

      return res.json({
        group: { id: group.id, name: group.name },
        role,
        members: [ownerEntry, ...memberEntries],
      });
    } catch (err) {
      console.error("GET /groups/:groupId error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /groups/lookup:
 *   get:
 *     summary: Find a group's ID by name (current user's groups)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *         required: true
 *         description: Group name to lookup (case-insensitive)
 *     responses:
 *       200:
 *         description: Group found
 *       404:
 *         description: Group not found
 */
router.get(
  "/lookup",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const name = String(req.query.name || "").trim();
      if (!name) return res.status(400).json({ error: "name is required" });

      const me = req.user.id;
      const group = await prisma.group.findFirst({
        where: {
          name: { equals: name, mode: "insensitive" },
          OR: [{ ownerId: me }, { members: { some: { userId: me } } }],
        },
        select: { id: true, name: true },
        orderBy: { id: "asc" },
      });

      if (!group) return res.status(404).json({ error: "Group not found" });
      return res.json(group);
    } catch (err) {
      console.error("GET /groups/lookup error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/** Helper: choose secret for group invites */
function getInviteSecret() {
  return process.env.GROUP_INVITE_SECRET || process.env.JWT_SECRET || "";
}

/**
 * @swagger
 * /groups/{groupId}/invite:
 *   post:
 *     summary: Create a short-lived invite token for joining a group (owner only)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expiresInSeconds:
 *                 type: integer
 *                 description: TTL in seconds (default 900 = 15 minutes)
 *     responses:
 *       200:
 *         description: Invite created
 */
router.post(
  "/:groupId/invite",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const groupId = Number(req.params.groupId);
      if (!Number.isFinite(groupId))
        return res.status(400).json({ error: "Invalid groupId" });

      const group = await prisma.group.findUnique({
        where: { id: groupId },
        select: { ownerId: true, name: true },
      });
      if (!group) return res.status(404).json({ error: "Group not found" });
      if (group.ownerId !== req.user.id)
        return res.status(403).json({ error: "Forbidden" });

      const secret = getInviteSecret();
      if (!secret)
        return res.status(500).json({ error: "Invite secret missing" });

      const nowSec = Math.floor(Date.now() / 1000);
      const ttl = Math.max(
        60,
        Math.min(3600, Number(req.body?.expiresInSeconds) || 900)
      );
      const exp = nowSec + ttl;
      const payload = {
        typ: "group_invite" as const,
        gid: groupId,
        oid: group.ownerId,
        iat: nowSec,
        exp,
      };
      const token = jwt.sign(payload, secret);

      const baseUrl =
        process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const url = `${baseUrl}/groups/join?token=${encodeURIComponent(token)}`;

      console.log("/groups invite created:", {
        groupId,
        ownerId: group.ownerId,
        exp,
      });
      return res.json({
        token,
        url,
        expiresAt: new Date(exp * 1000).toISOString(),
      });
    } catch (err) {
      console.error("POST /groups/:groupId/invite error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /groups/join:
 *   post:
 *     summary: Join a group via invite token (auth required); auto-friend with owner
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Joined or already a member
 */
router.post(
  "/join",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const token =
        typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (!token) return res.status(400).json({ error: "token is required" });

      const secret = getInviteSecret();
      if (!secret)
        return res.status(500).json({ error: "Invite secret missing" });

      let decoded: any;
      try {
        decoded = jwt.verify(token, secret);
      } catch (e) {
        console.warn("/groups join invalid token:", e);
        return res.status(400).json({ error: "Invalid or expired token" });
      }

      if (
        !decoded ||
        decoded.typ !== "group_invite" ||
        !decoded.gid ||
        !decoded.oid
      )
        return res.status(400).json({ error: "Invalid token payload" });

      const groupId = Number(decoded.gid);
      const ownerId = Number(decoded.oid);
      if (!Number.isFinite(groupId) || !Number.isFinite(ownerId))
        return res.status(400).json({ error: "Invalid token claims" });

      const group = await prisma.group.findUnique({
        where: { id: groupId },
        select: { ownerId: true },
      });
      if (!group) return res.status(404).json({ error: "Group not found" });
      // Invalidate token if ownership changed
      if (group.ownerId !== ownerId)
        return res
          .status(400)
          .json({ error: "Invite no longer valid (owner changed)" });

      const userId = req.user.id;
      if (userId === ownerId) {
        return res.json({ joined: false, member: "owner" });
      }

      // Ensure friendship (ACCEPTED)
      let friendshipStatus: "existing" | "accepted" | "created" = "existing";
      const existing = await prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: ownerId, receiverId: userId },
            { requesterId: userId, receiverId: ownerId },
          ],
        },
      });
      if (existing) {
        if (existing.status !== "ACCEPTED") {
          await prisma.friendship.update({
            where: { id: existing.id },
            data: { status: "ACCEPTED" },
          });
          friendshipStatus = "accepted";
        }
      } else {
        await prisma.friendship.create({
          data: {
            requesterId: ownerId,
            receiverId: userId,
            status: "ACCEPTED",
          },
        });
        friendshipStatus = "created";
      }

      // Ensure membership
      const member = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      let memberStatus: "existing" | "created" | "owner" = "existing";
      if (member) {
        memberStatus = "existing";
      } else if (group.ownerId === userId) {
        memberStatus = "owner";
      } else {
        await prisma.groupMember.create({
          data: { groupId, userId, role: "MEMBER" },
        });
        memberStatus = "created";
      }

      console.log("/groups join:", {
        groupId,
        userId,
        friendshipStatus,
        memberStatus,
      });
      return res.json({
        joined: memberStatus !== "owner",
        friendship: friendshipStatus,
        member: memberStatus,
      });
    } catch (err) {
      console.error("POST /groups/join error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

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

/**
 * @swagger
 * /groups/{groupId}/members/{uniqueId}/promote:
 *   patch:
 *     summary: Transfer ownership to a member (owner only)
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
 *         description: Ownership transferred
 */
router.patch(
  "/:groupId/members/:uniqueId/promote",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const groupId = Number(req.params.groupId);
      const uniqueId = String(req.params.uniqueId || "").trim();
      if (!Number.isFinite(groupId))
        return res.status(400).json({ error: "Invalid groupId" });
      if (!uniqueId) return res.status(400).json({ error: "Invalid uniqueId" });

      const group = await prisma.group.findUnique({
        where: { id: groupId },
        select: { ownerId: true },
      });
      if (!group) return res.status(404).json({ error: "Group not found" });

      // Only current owner can transfer ownership
      if (group.ownerId !== req.user.id)
        return res.status(403).json({ error: "Forbidden" });

      const target = await prisma.user.findUnique({
        where: { uniqueId },
        select: { id: true },
      });
      if (!target) return res.status(404).json({ error: "User not found" });
      if (target.id === group.ownerId)
        return res.json({ success: true, transferred: false });

      const member = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: target.id } },
        select: { userId: true },
      });
      if (!member)
        return res.status(404).json({ error: "User is not a group member" });

      const previousOwnerId = group.ownerId;

      // Transfer ownership
      await prisma.group.update({
        where: { id: groupId },
        data: { ownerId: target.id },
      });

      // Ensure previous owner stays as a member
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId, userId: previousOwnerId } },
        update: {},
        create: { groupId, userId: previousOwnerId, role: "MEMBER" },
      });

      console.log("/groups transfer ownership:", {
        groupId,
        from: previousOwnerId,
        to: target.id,
      });
      return res.json({ success: true, transferred: true });
    } catch (err) {
      console.error(
        "PATCH /groups/:groupId/members/:uniqueId/promote error:",
        err
      );
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
