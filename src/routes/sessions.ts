import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../config/prisma.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import { parseReceipt } from "../services/receiptParser.js";

const router = Router();

/**
 * @swagger
 * /sessions/scan:
 *   post:
 *     summary: Parse receipt image (session creation + immediate normalized items)
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionName, language, image]
 *             properties:
 *               sessionName:
 *                 type: string
 *                 example: "Кафе на Октябрь"
 *               language:
 *                 type: string
 *                 example: ru-RU
 *               image:
 *                 type: object
 *                 required: [mimeType, data]
 *                 properties:
 *                   mimeType:
 *                     type: string
 *                     example: image/jpeg
 *                   data:
 *                     type: string
 *                     description: Base64 image data
 *     responses:
 *       200:
 *         description: Parsed receipt items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId: { type: integer }
 *                 sessionName: { type: string }
 *                 language: { type: string }
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       name: { type: string }
 *                       unitPrice: { type: number }
 *                       quantity: { type: number }
 *                       totalPrice: { type: number }
 *                       kind: { type: string, nullable: true }
 *                 summary:
 *                   type: object
 *                   properties:
 *                     grandTotal: { type: number }
 */
router.post(
  "/scan",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { sessionName, language, image } = req.body || {};
      if (!sessionName || typeof sessionName !== "string") {
        return res.status(400).json({ error: "sessionName required" });
      }
      if (!language || typeof language !== "string") {
        return res.status(400).json({ error: "language required" });
      }
      if (
        !image ||
        typeof image !== "object" ||
        !image.mimeType ||
        !image.data
      ) {
        return res
          .status(400)
          .json({ error: "image { mimeType, data } required" });
      }

      // Create session (name field exists in schema but older DB may lack column; ignore until migration applied)
      const session = await prisma.session.create({
        data: {
          creatorId: req.user.id,
          status: "ACTIVE",
        },
        select: { id: true },
      });

      const parseResult = await parseReceipt({
        language,
        sessionName,
        mimeType: image.mimeType,
        imageBase64: image.data,
      });

      return res.json({
        sessionId: session.id,
        sessionName,
        language,
        items: parseResult.items,
        summary: parseResult.summary,
        source: parseResult.source,
        ...(process.env.DEBUG_PARSE === "1" && parseResult.rawModelText
          ? {
              _debug: {
                model: parseResult.model,
                durationMs: parseResult.durationMs,
                usedModelVersion: parseResult.usedModelVersion,
                modelsTried: parseResult.modelsTried,
                raw: parseResult.rawModelText,
              },
            }
          : {}),
      });
    } catch (err) {
      console.error("POST /sessions/scan error", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

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
 *             type: object
 *             properties:
 *               groupId:
 *                 type: integer
 *                 nullable: true
 *               serviceFee:
 *                 type: number
 *                 nullable: true
 *               total:
 *                 type: number
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Session created
 */
router.post("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const groupId = req.body?.groupId;
    const serviceFee = Number(req.body?.serviceFee ?? 0);
    const total = Number(req.body?.total ?? 0);

    let groupCheck = null as null | { ownerId: number };
    if (groupId != null) {
      const gid = Number(groupId);
      if (!Number.isFinite(gid))
        return res.status(400).json({ error: "Invalid groupId" });
      groupCheck = await prisma.group.findUnique({
        where: { id: gid },
        select: { ownerId: true },
      });
      if (!groupCheck)
        return res.status(404).json({ error: "Group not found" });
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
 */
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const groupId =
      req.query.groupId != null ? Number(req.query.groupId) : undefined;
    const where =
      groupId && Number.isFinite(groupId)
        ? { groupId }
        : { creatorId: req.user.id };

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

/**
 * @swagger
 * /sessions/finalize:
 *   post:
 *     summary: Finalize a session by computing allocations for provided items & participants (purely computational for now)
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, participants, items]
 *             properties:
 *               sessionId: { type: integer }
 *               sessionName: { type: string }
 *               participants:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [uniqueId, username]
 *                   properties:
 *                     uniqueId: { type: string }
 *                     username: { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [id, name, price, quantity, splitMode]
 *                   properties:
 *                     id: { type: string }
 *                     name: { type: string }
 *                     price: { type: number }
 *                     quantity: { type: number }
 *                     kind: { type: string, nullable: true }
 *                     splitMode: { type: string, enum: [equal, count] }
 *                     perPersonCount: { type: object, additionalProperties: { type: number } }
 *                     assignedTo: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Finalized allocations
 */
router.post(
  "/finalize",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { sessionId, sessionName, participants, items } = req.body || {};
      if (!Number.isFinite(Number(sessionId))) {
        return res.status(400).json({ error: "sessionId required" });
      }
      if (!Array.isArray(participants) || participants.length === 0) {
        return res.status(400).json({ error: "participants array required" });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "items array required" });
      }

      const session = await prisma.session.findUnique({
        where: { id: Number(sessionId) },
        select: { id: true, creatorId: true, createdAt: true },
      });
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (session.creatorId !== req.user.id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      interface ParticipantInfo {
        uniqueId: string;
        username: string;
      }
      interface ItemInput {
        id: string;
        name: string;
        price?: number;
        unitPrice?: number;
        totalPrice?: number;
        quantity: number;
        kind?: string;
        splitMode?: "equal" | "count";
        perPersonCount?: Record<string, number>;
        assignedTo?: string[];
      }
      const pList: ParticipantInfo[] = participants.map((p: any) => ({
        uniqueId: String(p.uniqueId),
        username: String(p.username || p.uniqueId),
      }));
      const participantIndex = new Map<string, ParticipantInfo>();
      for (const p of pList) participantIndex.set(p.uniqueId, p);

      const allocs: any[] = [];
      const byParticipantTotals = new Map<string, number>();
      const byItem: Array<{
        itemId: string;
        name: string;
        total: number;
        kind?: string | undefined;
      }> = [];

      function round2(n: number) {
        return Math.round(n * 100) / 100;
      }

      if (process.env.DEBUG_PARSE === "1") {
        console.log(
          "[finalize] participants=",
          pList.length,
          "items=",
          items.length
        );
      }

      for (const raw of items as ItemInput[]) {
        if (!raw || typeof raw !== "object") continue;
        const { id, name, quantity } = raw;
        // prefer explicit price/unitPrice; else derive from totalPrice/quantity
        let unitPrice = Number(
          raw.price ??
            raw.unitPrice ??
            (raw.totalPrice && quantity
              ? Number(raw.totalPrice) / Number(quantity)
              : NaN)
        );
        const qty = Number(quantity);
        // infer splitMode if missing
        let splitMode: "equal" | "count" | undefined = raw.splitMode;
        if (!splitMode) {
          if (raw.perPersonCount) splitMode = "count";
          else splitMode = "equal";
        }
        if (
          !id ||
          !name ||
          !Number.isFinite(unitPrice) ||
          !Number.isFinite(qty) ||
          qty <= 0
        ) {
          return res
            .status(400)
            .json({ error: `Invalid item fields for id=${id}` });
        }
        const itemTotal = round2(
          Number(
            raw.totalPrice != null && Number.isFinite(Number(raw.totalPrice))
              ? raw.totalPrice
              : unitPrice * qty
          )
        );
        if (raw.kind != null) {
          byItem.push({ itemId: id, name, total: itemTotal, kind: raw.kind });
        } else {
          byItem.push({ itemId: id, name, total: itemTotal });
        }

        if (splitMode === "count") {
          const counts = raw.perPersonCount || {};
          // Validate participants
          let sumUnits = 0;
          for (const [pid, units] of Object.entries(counts)) {
            if (!participantIndex.has(pid)) {
              return res.status(400).json({
                error: `Unknown participant in perPersonCount: ${pid}`,
              });
            }
            const u = Number(units) || 0;
            if (u < 0)
              return res
                .status(400)
                .json({ error: `Negative units for ${pid}` });
            sumUnits += u;
          }
          if (sumUnits !== qty) {
            return res.status(400).json({
              error: `Sum of perPersonCount (${sumUnits}) must equal quantity (${qty}) for item ${id}`,
            });
          }
          for (const [pid, units] of Object.entries(counts)) {
            const u = Number(units) || 0;
            const shareAmount = round2(u * unitPrice);
            allocs.push({
              itemId: id,
              participantId: pid,
              shareUnits: u,
              shareAmount,
            });
            byParticipantTotals.set(
              pid,
              round2((byParticipantTotals.get(pid) || 0) + shareAmount)
            );
          }
        } else if (splitMode === "equal") {
          const assigned = Array.isArray(raw.assignedTo) ? raw.assignedTo : [];
          if (assigned.length === 0) {
            return res.status(400).json({
              error: `assignedTo required for equal split item ${id}`,
            });
          }
          const valid = assigned.filter((pid) => participantIndex.has(pid));
          if (valid.length !== assigned.length) {
            return res.status(400).json({
              error: `Unknown participant in assignedTo for item ${id}`,
            });
          }
          const ratio = 1 / valid.length;
          let allocated = 0;
          valid.forEach((pid, idx) => {
            let shareAmount = unitPrice * qty * ratio; // raw
            if (idx === valid.length - 1) {
              // last one gets the remainder to avoid rounding drift
              shareAmount = unitPrice * qty - allocated;
            }
            shareAmount = round2(shareAmount);
            allocated = round2(allocated + shareAmount);
            allocs.push({
              itemId: id,
              participantId: pid,
              shareRatio: ratio,
              shareAmount,
            });
            byParticipantTotals.set(
              pid,
              round2((byParticipantTotals.get(pid) || 0) + shareAmount)
            );
          });
        } else {
          return res.status(400).json({
            error: `Unsupported splitMode '${splitMode}' for item ${id}`,
          });
        }
      }

      const grandTotal = round2(byItem.reduce((s, it) => s + it.total, 0));
      const byParticipant = pList.map((p) => ({
        uniqueId: p.uniqueId,
        username: p.username,
        amountOwed: round2(byParticipantTotals.get(p.uniqueId) || 0),
      }));

      if (process.env.DEBUG_PARSE === "1") {
        console.log("[finalize] byItem=", byItem);
        console.log("[finalize] byParticipant=", byParticipant);
      }

      return res.json({
        sessionId: Number(sessionId),
        sessionName: sessionName || null,
        status: "finalized",
        createdAt: session.createdAt,
        totals: {
          grandTotal,
          byParticipant,
          byItem,
        },
        allocations: allocs,
      });
    } catch (err) {
      console.error("POST /sessions/finalize error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
