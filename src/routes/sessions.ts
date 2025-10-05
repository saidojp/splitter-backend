import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../config/prisma.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import {
  parseReceiptWithGemini,
  translateDescriptionsWithGemini,
} from "../services/receipt/geminiProvider.js";

const router = Router();

// Helper to check if user is allowed (creator, group member, or participant)
async function authorizeSessionAccess(sessionId: number, userId: number) {
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
      participants: { select: { userId: true } },
      group: {
        select: {
          id: true,
          members: { select: { userId: true } },
          ownerId: true,
        },
      },
    },
  });
  if (!session) return { allowed: false, notFound: true } as const;
  if (session.creatorId === userId) return { allowed: true, session } as const;
  // group membership
  if (session.group) {
    if (session.group.ownerId === userId) return { allowed: true, session } as const;
    if (session.group.members.some((m) => m.userId === userId)) {
      return { allowed: true, session } as const;
    }
  }
  // participant membership
  if (session.participants.some((p) => p.userId === userId)) {
    return { allowed: true, session } as const;
  }
  return { allowed: false, session } as const;
}

// Central helper to build parse summary (cached counts first, fallback to compute array length)
async function buildParseSummary(sessionId: number) {
  const parseRec = await (prisma as any).receiptParse.findUnique({
    where: { sessionId },
    select: {
      status: true,
      detectedLanguage: true,
      targetLanguage: true,
      translationApplied: true,
      provider: true,
      model: true,
      errorMessage: true,
      linesCount: true,
      itemsCount: true,
      updatedAt: true,
    },
  });
  if (!parseRec) {
    return {
      status: "PENDING",
      detectedLanguage: null,
      targetLanguage: null,
      translationApplied: false,
      provider: null,
      model: null,
      errorMessage: null,
      linesCount: 0,
      itemsCount: 0,
      updatedAt: null,
    };
  }
  return {
    status: parseRec.status,
    detectedLanguage: parseRec.detectedLanguage,
    targetLanguage: parseRec.targetLanguage,
    translationApplied: parseRec.translationApplied,
    provider: parseRec.provider,
    model: parseRec.model,
    errorMessage: parseRec.errorMessage,
    linesCount: parseRec.linesCount || 0,
    itemsCount: parseRec.itemsCount || 0,
    updatedAt: parseRec.updatedAt,
  };
}

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

export default router;

/**
 * @swagger
 * /sessions/{sessionId}:
 *   get:
 *     summary: Get session detail (with receipt items & parse summary)
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
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Session not found
 */
router.get(
  "/:sessionId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const sessionId = Number(req.params.sessionId);
      if (!Number.isFinite(sessionId)) {
        return res.status(400).json({ error: "Invalid sessionId" });
      }
      const auth = await authorizeSessionAccess(sessionId, req.user.id);
      if (auth.notFound) return res.status(404).json({ error: "Session not found" });
      if (!auth.allowed) return res.status(403).json({ error: "Forbidden" });
      const s = auth.session!;
      const parseSummary = await buildParseSummary(sessionId);
      const items = await prisma.receiptItem.findMany({
        where: { sessionId },
        select: { id: true, sessionId: true, name: true, price: true },
        orderBy: { id: "asc" },
      });
      // participants list
      const participants = await prisma.sessionParticipant.findMany({
        where: { sessionId },
        select: { userId: true, amountOwed: true },
      });
      return res.json({
        id: s.id,
        creatorId: s.creatorId,
        groupId: s.groupId,
        receiptImageUrl: s.receiptImageUrl,
        serviceFee: Number(s.serviceFee),
        total: Number(s.total),
        status: s.status,
        createdAt: s.createdAt,
        parse: parseSummary,
        participants: participants.map((p) => ({
          userId: p.userId,
          amountOwed: Number(p.amountOwed),
        })),
        items: items.map((i) => ({
          id: i.id,
          sessionId: i.sessionId,
          name: i.name,
          price: Number(i.price),
        })),
      });
    } catch (err) {
      console.error("GET /sessions/:sessionId detail error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /sessions/{sessionId}/receipt/parse:
 *   get:
 *     summary: Get receipt parse status & summary
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
 *         description: Parse summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [PENDING, PROCESSING, COMPLETED, FAILED]
 *                 detectedLanguage:
 *                   type: string
 *                   nullable: true
 *                 targetLanguage:
 *                   type: string
 *                   nullable: true
 *                 translationApplied:
 *                   type: boolean
 *                 provider:
 *                   type: string
 *                   nullable: true
 *                 model:
 *                   type: string
 *                   nullable: true
 *                 errorMessage:
 *                   type: string
 *                   nullable: true
 *                 linesCount:
 *                   type: integer
 *                 itemsCount:
 *                   type: integer
 *                 updatedAt:
 *                   type: string
 *               required: [status, translationApplied, linesCount, itemsCount]
 *               example:
 *                 status: COMPLETED
 *                 detectedLanguage: uz
 *                 targetLanguage: ja
 *                 translationApplied: true
 *                 provider: gemini
 *                 model: gemini-1.5-flash
 *                 errorMessage: null
 *                 linesCount: 18
 *                 itemsCount: 12
 *                 updatedAt: 2025-10-05T10:20:00.000Z
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Session not found
 */
router.get(
  "/:sessionId/receipt/parse",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const sessionId = Number(req.params.sessionId);
      if (!Number.isFinite(sessionId)) {
        return res.status(400).json({ error: "Invalid sessionId" });
      }
      const auth = await authorizeSessionAccess(sessionId, req.user.id);
      if (auth.notFound) return res.status(404).json({ error: "Session not found" });
      if (!auth.allowed) return res.status(403).json({ error: "Forbidden" });
      const summary = await buildParseSummary(sessionId);
      return res.json(summary);
    } catch (err) {
      console.error("GET /sessions/:sessionId/receipt/parse error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /sessions/{sessionId}/receipt/parse:
 *   post:
 *     summary: Parse receipt image for a session (Gemini)
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               targetLanguage:
 *                 type: string
 *                 example: ja
 *               receiptLanguageHint:
 *                 type: string
 *                 example: uz
 *               force:
 *                 type: boolean
 *                 example: false
 *     responses:
 *       200:
 *         description: Parse started or completed
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Session not found
 */
router.post(
  "/:sessionId/receipt/parse",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      if (!process.env.GEMINI_API_KEY)
        return res.status(501).json({ error: "Receipt parsing disabled" });
      const sessionId = Number(req.params.sessionId);
      if (!Number.isFinite(sessionId))
        return res.status(400).json({ error: "Invalid sessionId" });
      const { targetLanguage, receiptLanguageHint, force } = req.body ?? {};
      const allow = (process.env.RECEIPT_ALLOWED_LANGS || "en,ja,uz,ru")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (targetLanguage && !allow.includes(targetLanguage)) {
        return res.status(400).json({ error: "Unsupported targetLanguage" });
      }

      const sessionBase = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { id: true, creatorId: true, groupId: true, receiptImageUrl: true },
      });
      if (!sessionBase) return res.status(404).json({ error: "Session not found" });
      if (!sessionBase.receiptImageUrl)
        return res.status(400).json({ error: "No receiptImageUrl in session" });
      const auth = await authorizeSessionAccess(sessionId, req.user.id);
      if (!auth.allowed) return res.status(403).json({ error: "Forbidden" });

      // TODO: remove 'as any' once TS picks up new Prisma client types
      const existingParse = await (prisma as any).receiptParse.findUnique({
        where: { sessionId },
      });
      if (existingParse && existingParse.status === "PROCESSING" && !force) {
        return res.json({
          status: existingParse.status,
          message: "Already processing",
        });
      }

      // Upsert parse entry (PENDING->PROCESSING)
      const parseRecord = await (prisma as any).receiptParse.upsert({
        where: { sessionId },
        update: {
          status: "PROCESSING",
          targetLanguage: targetLanguage || null,
        },
        create: {
          sessionId,
          status: "PROCESSING",
          targetLanguage: targetLanguage || null,
        },
      });

      // Inline processing MVP
      try {
        const parsed = await parseReceiptWithGemini(
          sessionBase.receiptImageUrl,
          targetLanguage,
          receiptLanguageHint
        );
        // translations if needed
        let translations: string[] | null = null;
        if (
          parsed.items.length &&
          targetLanguage &&
          parsed.detectedLanguage &&
          targetLanguage !== parsed.detectedLanguage
        ) {
          translations = (
            await translateDescriptionsWithGemini(
              targetLanguage,
              parsed.items.map((i) => i.descriptionOriginal)
            )
          ).translations;
        }

        // Persist parse
        await prisma.$transaction(async (tx) => {
          await (tx as any).receiptParse.update({
            where: { sessionId },
            data: {
              status: "COMPLETED",
              provider: "gemini",
              model: process.env.GEMINI_MODEL_PARSE || null,
              detectedLanguage: parsed.detectedLanguage || null,
              rawText: parsed.rawTextCombined || null,
              rawJson: JSON.stringify(parsed.rawJson).slice(0, 100000),
              confidence: null,
              translationApplied: translations ? true : false,
              linesCount: parsed.items.length,
              itemsCount: parsed.items.length, // currently only item lines stored
            },
          });
          // Clear old lines & items (simplistic reparse strategy)
          const rp = await (tx as any).receiptParse.findUnique({
            where: { sessionId },
          });
          if (rp) {
            await (tx as any).receiptLine.deleteMany({
              where: { receiptParseId: rp.id },
            });
          }
          await tx.receiptItem.deleteMany({ where: { sessionId } });
          for (let idx = 0; idx < parsed.items.length; idx++) {
            const it = parsed.items[idx];
            if (!it) continue;
            const translated = translations ? translations[idx] : null;
            if (!rp) break;
            await (tx as any).receiptLine.create({
              data: {
                receiptParseId: rp.id,
                lineIndex: idx,
                rawLine: it.descriptionOriginal || "",
                isItem: true,
                descriptionOriginal: it.descriptionOriginal || null,
                description: translated || null,
                quantity: (it.quantity && it.quantity > 0
                  ? it.quantity
                  : 1) as any,
                unitPrice: it.unitPrice ? (it.unitPrice as any) : undefined,
                lineTotal: it.lineTotal ? (it.lineTotal as any) : undefined,
                currency: it.currency || parsed.currency || null,
              },
            });
            await tx.receiptItem.create({
              data: {
                sessionId,
                name: translated || it.descriptionOriginal || "Item",
                price: (it.lineTotal || it.unitPrice || "0") as any,
              },
            });
          }
        });

        return res.json({
          status: "COMPLETED",
          detectedLanguage: parsed.detectedLanguage,
          targetLanguage: targetLanguage || null,
          translationApplied: !!translations,
          items: parsed.items.map((i, idx) => ({
            descriptionOriginal: i.descriptionOriginal,
            description: translations
              ? translations[idx]
              : i.descriptionOriginal,
            quantity: i.quantity || 1,
            unitPrice: i.unitPrice || null,
            lineTotal: i.lineTotal || null,
            currency: i.currency || parsed.currency || null,
          })),
          warnings: parsed.warnings || [],
        });
      } catch (e: any) {
        await (prisma as any).receiptParse.update({
          where: { sessionId },
          data: {
            status: "FAILED",
            errorMessage: e.message?.slice(0, 500) || "parse error",
          },
        });
        return res
          .status(500)
          .json({ error: "Parse failed", detail: e.message });
      }
    } catch (err) {
      console.error("POST /sessions/:sessionId/receipt/parse error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /sessions/{sessionId}/receipt/translate:
 *   post:
 *     summary: Re-translate parsed receipt to another target language
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               targetLanguage:
 *                 type: string
 *                 example: ja
 *     responses:
 *       200:
 *         description: Translation completed
 */
router.post(
  "/:sessionId/receipt/translate",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      if (!process.env.GEMINI_API_KEY)
        return res.status(501).json({ error: "Translation disabled" });
      const sessionId = Number(req.params.sessionId);
      if (!Number.isFinite(sessionId))
        return res.status(400).json({ error: "Invalid sessionId" });
      const { targetLanguage } = req.body ?? {};
      if (typeof targetLanguage !== "string")
        return res.status(400).json({ error: "targetLanguage required" });
      const allow = (process.env.RECEIPT_ALLOWED_LANGS || "en,ja,uz,ru")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!allow.includes(targetLanguage))
        return res.status(400).json({ error: "Unsupported targetLanguage" });

      const auth = await authorizeSessionAccess(sessionId, req.user.id);
      if (auth.notFound) return res.status(404).json({ error: "Session not found" });
      if (!auth.allowed) return res.status(403).json({ error: "Forbidden" });
      const parseRec = await (prisma as any).receiptParse.findUnique({
        where: { sessionId },
        include: { lines: true },
      });
      if (!parseRec || parseRec.status !== "COMPLETED")
        return res
          .status(400)
          .json({ error: "No completed parse to translate" });

      const originals = parseRec.lines
        .filter((l: any) => l.isItem && l.descriptionOriginal)
        .map((l: any) => l.descriptionOriginal as string);
      if (!originals.length)
        return res.status(400).json({ error: "No items to translate" });

      const { translations } = await translateDescriptionsWithGemini(
        targetLanguage,
        originals
      );

      await prisma.$transaction(async (tx) => {
        // Preload items once
        const items = await tx.receiptItem.findMany({
          where: { sessionId },
          orderBy: { id: "asc" },
        });
        let t = 0;
        for (let i = 0; i < parseRec.lines.length; i++) {
          const line = parseRec.lines[i];
          if (!line) continue;
          if (line.isItem && line.descriptionOriginal) {
            const translated = translations[t];
            if (translated) {
              await (tx as any).receiptLine.update({
                where: { id: line.id },
                data: { description: translated as string },
              });
              if (items[t]) {
                const targetItem = items[t];
                if (targetItem) {
                  await tx.receiptItem.update({
                    where: { id: targetItem.id },
                    data: { name: translated as string },
                  });
                }
              }
            }
            t++;
          }
        }
        await (tx as any).receiptParse.update({
          where: { sessionId },
          data: { targetLanguage, translationApplied: true },
        });
      });

      return res.json({ status: "COMPLETED", targetLanguage });
    } catch (err) {
      console.error("POST /sessions/:sessionId/receipt/translate error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);
