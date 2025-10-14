import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../config/prisma.js";
import type { Prisma } from "@prisma/client";
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

      const acceptedAt = new Date();
      // Create session recording acceptance time
      // @ts-ignore new field parseAcceptedAt will exist after prisma generate
      const session = await prisma.session.create({
        data: {
          creatorId: req.user.id,
          status: "ACTIVE",
          // @ts-ignore field generated after migrate
          parseAcceptedAt: acceptedAt,
        },
        select: { id: true },
      });

      const parseResult = await parseReceipt({
        language,
        sessionName,
        mimeType: image.mimeType,
        imageBase64: image.data,
      });

      const resultReturnedAt = new Date();
      // Persist timing markers (best-effort, ignore failures)
      try {
        // We treat requestSentAt/responseReceivedAt as provided by parseResult
        // @ts-ignore new timing fields until prisma generate
        await prisma.session.update({
          where: { id: session.id },
          data: {
            // @ts-ignore field generated after migrate
            parseRequestSentAt: parseResult.requestSentAt
              ? new Date(parseResult.requestSentAt)
              : null,
            // @ts-ignore field generated after migrate
            parseResponseAt: parseResult.responseReceivedAt
              ? new Date(parseResult.responseReceivedAt)
              : null,
            // @ts-ignore field generated after migrate
            parseResultReturnedAt: resultReturnedAt,
          },
          select: { id: true },
        });
      } catch (e) {
        console.warn("[scan] Failed to persist parse timing markers", e);
      }

      if (process.env.DEBUG_PARSE === "1") {
        const reqSent = parseResult.requestSentAt
          ? new Date(parseResult.requestSentAt)
          : null;
        const respRecv = parseResult.responseReceivedAt
          ? new Date(parseResult.responseReceivedAt)
          : null;
        const tAcceptedToReq = reqSent
          ? reqSent.getTime() - acceptedAt.getTime()
          : undefined;
        const tReqToResp =
          reqSent && respRecv
            ? respRecv.getTime() - reqSent.getTime()
            : undefined;
        const tRespToReturn = respRecv
          ? resultReturnedAt.getTime() - respRecv.getTime()
          : undefined;
        const total = resultReturnedAt.getTime() - acceptedAt.getTime();
        console.log(
          `[timing][scan] session=${session.id} accepted->request=${tAcceptedToReq}ms request->response=${tReqToResp}ms response->return=${tRespToReturn}ms total=${total}ms`
        );
      }

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
                timing: {
                  acceptedAt: acceptedAt.toISOString(),
                  requestSentAt: parseResult.requestSentAt,
                  responseReceivedAt: parseResult.responseReceivedAt,
                  resultReturnedAt: resultReturnedAt.toISOString(),
                },
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
        avatarUrl?: string | null;
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
        avatarUrl: p.avatarUrl ?? null,
      }));
      const participantIndex = new Map<string, ParticipantInfo>();
      for (const p of pList) participantIndex.set(p.uniqueId, p);

      const allocs: any[] = [];
      // We'll derive totals AFTER generating allocations to have a single source of truth.
      const itemMeta = new Map<string, { name: string; kind?: string }>();

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
        if (raw.kind != null) {
          itemMeta.set(id, { name, kind: raw.kind });
        } else {
          itemMeta.set(id, { name });
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
            // participant totals will be derived later
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
            // participant totals will be derived later
          });
        } else {
          return res.status(400).json({
            error: `Unsupported splitMode '${splitMode}' for item ${id}`,
          });
        }
      }

      // Derive totals from allocations
      const byItemMap = new Map<
        string,
        { itemId: string; name: string; total: number; kind?: string }
      >();
      const byParticipantTotals = new Map<string, number>();
      for (const a of allocs) {
        const itemId = a.itemId;
        const shareAmount = Number(a.shareAmount) || 0;
        if (!byItemMap.has(itemId)) {
          const meta = itemMeta.get(itemId);
          byItemMap.set(itemId, {
            itemId,
            name: meta?.name || itemId,
            total: 0,
            ...(meta?.kind ? { kind: meta.kind } : {}),
          });
        }
        const entry = byItemMap.get(itemId)!;
        entry.total = round2(entry.total + shareAmount);
        const pid = a.participantId;
        byParticipantTotals.set(
          pid,
          round2((byParticipantTotals.get(pid) || 0) + shareAmount)
        );
      }
      const byItem = Array.from(byItemMap.values());
      const grandTotal = round2(byItem.reduce((s, it) => s + it.total, 0));
      const byParticipant = pList.map((p) => ({
        uniqueId: p.uniqueId,
        username: p.username,
        amountOwed: round2(byParticipantTotals.get(p.uniqueId) || 0),
      }));
      if (process.env.DEBUG_PARSE === "1") {
        console.log("[finalize] derived byItem=", byItem);
        console.log("[finalize] derived byParticipant=", byParticipant);
      }

      // Persist snapshot to SessionHistory (idempotent: skip if exists)
      try {
        // @ts-ignore prisma client accessor generated after running `prisma migrate dev`
        const existing = await prisma.sessionHistoryEntry.findUnique({
          where: { sessionId: Number(sessionId) },
          select: { id: true },
        });
        if (!existing) {
          // Fetch owner user info (creator of session)
          const owner = await prisma.user.findUnique({
            where: { id: session.creatorId },
            select: { id: true, uniqueId: true, username: true },
          });
          // Enrich participants with avatarUrl from DB if not provided in request
          const missingAvatarIds = pList
            .filter((p) => !p.avatarUrl)
            .map((p) => p.uniqueId);
          if (missingAvatarIds.length) {
            const dbUsers = await prisma.user.findMany({
              where: { uniqueId: { in: missingAvatarIds } },
              select: { uniqueId: true, avatarUrl: true },
            });
            const avatarMap = new Map<string, string | null>(
              dbUsers.map((u) => [u.uniqueId, u.avatarUrl || null])
            );
            for (const p of pList) {
              if (!p.avatarUrl && avatarMap.has(p.uniqueId)) {
                p.avatarUrl = avatarMap.get(p.uniqueId) || null;
              }
            }
          }
          // @ts-ignore prisma client accessor generated after running `prisma migrate dev`
          await prisma.sessionHistoryEntry.create({
            data: {
              sessionId: Number(sessionId),
              sessionName: sessionName || null,
              status: "finalized",
              ownerUserId: owner?.id || null,
              ownerUniqueId: owner?.uniqueId || null,
              ownerUsername: owner?.username || null,
              participantUniqueIds: pList.map((p) => p.uniqueId),
              participants: pList as unknown as Prisma.InputJsonValue,
              allocations: allocs as unknown as Prisma.InputJsonValue,
              totals: {
                grandTotal,
                byItem,
                byParticipant,
              } as unknown as Prisma.InputJsonValue,
            },
          });
        }
      } catch (e) {
        console.error("[finalize] failed to persist SessionHistory:", e);
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
        participants: pList,
      });
    } catch (err) {
      console.error("POST /sessions/finalize error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;

// History endpoint (lightweight implementation)
/**
 * @swagger
 * /sessions/{sessionId}/history:
 *   get:
 *     summary: Get history snapshot for a specific session
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Snapshot if exists
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     exists: { type: boolean, enum: [false] }
 *                     sessionId: { type: integer }
 *                 - type: object
 *                   properties:
 *                     exists: { type: boolean, enum: [true] }
 *                     sessionId: { type: integer }
 *                     sessionName: { type: string, nullable: true }
 *                     createdAt: { type: string, format: date-time }
 *                     status: { type: string }
 *                     ownerId: { type: string, nullable: true }
 *                     ownerName: { type: string, nullable: true }
 *                     totals:
 *                       type: object
 *                       properties:
 *                         grandTotal: { type: number }
 *                         byItem: { type: array, items: { type: object } }
 *                         byParticipant: { type: array, items: { type: object } }
 *                     participants:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           uniqueId: { type: string }
 *                           username: { type: string }
 *                           avatarUrl: { type: string, nullable: true }
 *                     allocations:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           itemId: { type: string }
 *                           participantId: { type: string }
 *                           shareAmount: { type: number }
 *                           shareUnits: { type: number, nullable: true }
 *                           shareRatio: { type: number, nullable: true }
 */
router.get(
  "/:sessionId/history",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const sessionId = Number(req.params.sessionId);
      if (!Number.isFinite(sessionId))
        return res.status(400).json({ error: "Invalid sessionId" });
      // @ts-ignore prisma client accessor generated after running `prisma migrate dev`
      const entry = await prisma.sessionHistoryEntry.findUnique({
        where: { sessionId },
      });
      if (!entry) {
        return res.json({ exists: false, sessionId });
      }
      // propagate avatarUrl into byParticipant if missing
      try {
        if (
          Array.isArray(entry.participants) &&
          Array.isArray((entry as any).totals?.byParticipant)
        ) {
          const avatarMap = new Map<string, string | null>();
          for (const p of entry.participants as any[]) {
            if (p && p.uniqueId) avatarMap.set(p.uniqueId, p.avatarUrl || null);
          }
          for (const bp of (entry as any).totals.byParticipant) {
            if (bp && bp.uniqueId && bp.avatarUrl === undefined) {
              bp.avatarUrl = avatarMap.get(bp.uniqueId) || null;
            }
          }
        }
      } catch {}
      return res.json({
        exists: true,
        sessionId: entry.sessionId,
        sessionName: entry.sessionName,
        createdAt: entry.createdAt,
        status: entry.status,
        ownerId: entry.ownerUniqueId || null,
        ownerName: entry.ownerUsername || null,
        totals: entry.totals,
        participants: entry.participants,
        allocations: entry.allocations,
      });
    } catch (err) {
      console.error("GET /sessions/:sessionId/history error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /sessions/history:
 *   get:
 *     summary: Get finalized sessions history for a participant (by uniqueId) or current user if not provided
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: participantId
 *         schema:
 *           type: string
 *         required: false
 *         description: Participant uniqueId (e.g., "#5281"). If omitted, backend uses current user's uniqueId.
 *     responses:
 *       200:
 *         description: History payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 participantId:
 *                   type: string
 *                 sessions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       sessionId: { type: integer }
 *                       sessionName: { type: string, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *                       status: { type: string }
 *                       ownerId: { type: string, nullable: true }
 *                       ownerName: { type: string, nullable: true }
 *                       totals:
 *                         type: object
 *                         properties:
 *                           myTotal: { type: number, nullable: true }
 *                           grandTotal: { type: number }
 *                       participants:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             uniqueId: { type: string }
 *                             username: { type: string }
 *                             avatarUrl: { type: string, nullable: true }
 *                             avatarUrl: { type: string, nullable: true }
 *                       allocations:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             itemId: { type: string }
 *                             participantId: { type: string }
 *                             shareUnits: { type: number, nullable: true }
 *                             shareRatio: { type: number, nullable: true }
 *                             shareAmount: { type: number }
 *                       byItem:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             itemId: { type: string }
 *                             name: { type: string }
 *                             total: { type: number }
 *                             kind: { type: string, nullable: true }
 *                       byParticipant:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             uniqueId: { type: string }
 *                             username: { type: string }
 *                             amountOwed: { type: number }
 *             examples:
 *               sample:
 *                 summary: Example history response
 *                 value:
 *                   participantId: "#5281"
 *                   sessions:
 *                     - sessionId: 21
 *                       sessionName: "2025-10-07 21:43"
 *                       createdAt: "2025-10-07T16:55:20.901Z"
 *                       status: "finalized"
 *                       ownerId: "#5281"
 *                       ownerName: "said"
 *                       totals:
 *                         myTotal: 18750
 *                         grandTotal: 33500
 *                       participants:
 *                         - { uniqueId: "#5281", username: "said" }
 *                         - { uniqueId: "#5347", username: "said2", avatarUrl: null }
 *                       allocations:
 *                         - { itemId: "1", participantId: "#5281", shareAmount: 500, shareUnits: 1 }
 *                         - { itemId: "1", participantId: "#5347", shareAmount: 500, shareUnits: 1 }
 *                       byItem:
 *                         - { itemId: "1", name: "Кола", total: 1000 }
 *                       byParticipant:
 *                         - { uniqueId: "#5281", username: "said", amountOwed: 18750 }
 *                         - { uniqueId: "#5347", username: "said2", avatarUrl: null, amountOwed: 14750 }
 */
router.get(
  "/history",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const participantId = (req.query.participantId as string) || null;
      // We'll match by uniqueId snapshot. Need to fetch current user's uniqueId if no participantId
      let targetUniqueId = participantId;
      if (!targetUniqueId) {
        const me = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { uniqueId: true },
        });
        if (!me) return res.status(404).json({ error: "User not found" });
        targetUniqueId = me.uniqueId;
      }
      // @ts-ignore prisma client needs regeneration after adding model
      // @ts-ignore prisma client accessor generated after running `prisma migrate dev`
      const entries = await prisma.sessionHistoryEntry.findMany({
        where: {
          participantUniqueIds: { has: targetUniqueId },
          status: "finalized",
        },
        orderBy: { createdAt: "desc" },
      });
      const sessions = entries.map((e: any) => {
        // derive myTotal from totals.byParticipant if present
        let myTotal: number | undefined;
        try {
          const byP = e.totals?.byParticipant || [];
          const mine = byP.find((p: any) => p.uniqueId === targetUniqueId);
          myTotal = mine?.amountOwed;
        } catch {}
        // propagate avatarUrl from participants array into byParticipant if missing
        try {
          if (
            Array.isArray(e.participants) &&
            Array.isArray(e.totals?.byParticipant)
          ) {
            const avatarMap = new Map<string, string | null>();
            for (const p of e.participants) {
              if (p && p.uniqueId)
                avatarMap.set(p.uniqueId, p.avatarUrl || null);
            }
            for (const bp of e.totals.byParticipant) {
              if (bp && bp.uniqueId && bp.avatarUrl === undefined) {
                bp.avatarUrl = avatarMap.get(bp.uniqueId) || null;
              }
            }
          }
        } catch {}
        return {
          sessionId: e.sessionId,
          sessionName: e.sessionName,
          createdAt: e.createdAt,
          status: e.status,
          ownerId: e.ownerUniqueId || null,
          ownerName: e.ownerUsername || null,
          totals: {
            myTotal,
            grandTotal: e.totals?.grandTotal,
          },
          participants: e.participants,
          allocations: e.allocations,
          byItem: e.totals?.byItem || [],
          byParticipant: e.totals?.byParticipant || [],
        };
      });
      return res.json({ participantId: targetUniqueId, sessions });
    } catch (err) {
      console.error("GET /sessions/history error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /sessions/history/latest:
 *   get:
 *     summary: Get most recent finalized session snapshots for current user (as participant)
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, minimum: 1, maximum: 100 }
 *         required: false
 *         description: Max number of sessions to return (default 10, max 100)
 *     responses:
 *       200:
 *         description: Latest history snapshots
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 limit: { type: integer }
 *                 count: { type: integer }
 *                 sessions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       sessionId: { type: integer }
 *                       sessionName: { type: string, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *                       status: { type: string }
 *                       ownerId: { type: string, nullable: true }
 *                       ownerName: { type: string, nullable: true }
 *                       totals:
 *                         type: object
 *                         properties:
 *                           grandTotal: { type: number }
 *                           byItem: { type: array, items: { type: object } }
 *                           byParticipant: { type: array, items: { type: object } }
 *                       participants:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             uniqueId: { type: string }
 *                             username: { type: string }
 *                             avatarUrl: { type: string, nullable: true }
 *                       allocations:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             itemId: { type: string }
 *                             participantId: { type: string }
 *                             shareAmount: { type: number }
 *                             shareUnits: { type: number, nullable: true }
 *                             shareRatio: { type: number, nullable: true }
 *             examples:
 *               sample:
 *                 summary: Example latest history response
 *                 value:
 *                   limit: 3
 *                   count: 2
 *                   sessions:
 *                     - { sessionId: 25, sessionName: "Dinner", createdAt: "2025-10-14T12:00:00.000Z", status: "finalized" }
 *                     - { sessionId: 24, sessionName: "Lunch", createdAt: "2025-10-14T10:30:00.000Z", status: "finalized" }
 */
router.get(
  "/history/latest",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const limitRaw = req.query.limit as string | undefined;
      let limit = Number(limitRaw ?? 10);
      if (!Number.isFinite(limit) || limit <= 0) limit = 10;
      if (limit > 100) limit = 100;
      const me = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { uniqueId: true },
      });
      if (!me) return res.status(404).json({ error: "User not found" });
      // @ts-ignore prisma client accessor generated after running `prisma migrate dev`
      const entries = await prisma.sessionHistoryEntry.findMany({
        where: {
          participantUniqueIds: { has: me.uniqueId },
          status: "finalized",
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      const sessions = entries.map((e: any) => {
        // propagate avatar into byParticipant if needed
        try {
          if (
            Array.isArray(e.participants) &&
            Array.isArray(e.totals?.byParticipant)
          ) {
            const avatarMap = new Map<string, string | null>();
            for (const p of e.participants)
              if (p && p.uniqueId)
                avatarMap.set(p.uniqueId, p.avatarUrl || null);
            for (const bp of e.totals.byParticipant)
              if (bp && bp.uniqueId && bp.avatarUrl === undefined)
                bp.avatarUrl = avatarMap.get(bp.uniqueId) || null;
          }
        } catch {}
        return {
          sessionId: e.sessionId,
          sessionName: e.sessionName,
          createdAt: e.createdAt,
          status: e.status,
          ownerId: e.ownerUniqueId || null,
          ownerName: e.ownerUsername || null,
          totals: e.totals,
          participants: e.participants,
          allocations: e.allocations,
        };
      });
      return res.json({ limit, count: sessions.length, sessions });
    } catch (err) {
      console.error("GET /sessions/history/latest error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);
