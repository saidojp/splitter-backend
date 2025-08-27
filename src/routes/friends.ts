import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../config/prisma.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Friends
 *   description: Работа с друзьями и запросами в друзья
 */

/** Helper to select public fields */
const userPublicSelect = {
  id: true,
  email: true,
  username: true,
  uniqueId: true,
} as const;

/**
 * @swagger
 * /friends:
 *   get:
 *     summary: Список друзей текущего пользователя
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Список друзей
 */
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Не авторизован" });
    const userId = req.user.id;
    console.log("GET /friends for:", userId);

    const [asRequester, asReceiver] = await Promise.all([
      prisma.friendship.findMany({
        where: { requesterId: userId, status: "ACCEPTED" },
        include: { receiver: { select: userPublicSelect } },
      }),
      prisma.friendship.findMany({
        where: { receiverId: userId, status: "ACCEPTED" },
        include: { requester: { select: userPublicSelect } },
      }),
    ]);

    const friends = [
      ...asRequester.map((f) => f.receiver),
      ...asReceiver.map((f) => f.requester),
    ];
    console.log("GET /friends count:", friends.length);
    return res.json(friends);
  } catch (err) {
    console.error("/friends error:", err);
    return res.status(500).json({ error: "Ошибка сервера" });
  }
});

/**
 * @swagger
 * /friends/requests:
 *   get:
 *     summary: Показать входящие и исходящие запросы в друзья
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Запросы в друзья
 */
router.get(
  "/requests",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Не авторизован" });
      const userId = req.user.id;

      const [incoming, outgoing] = await Promise.all([
        prisma.friendship.findMany({
          where: { receiverId: userId, status: "PENDING" },
          include: { requester: { select: userPublicSelect } },
          orderBy: { createdAt: "desc" },
        }),
        prisma.friendship.findMany({
          where: { requesterId: userId, status: "PENDING" },
          include: { receiver: { select: userPublicSelect } },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      console.log("GET /friends/requests counts:", {
        incoming: incoming.length,
        outgoing: outgoing.length,
      });

      return res.json({
        incoming: incoming.map((r) => ({ id: r.id, from: r.requester })),
        outgoing: outgoing.map((r) => ({ id: r.id, to: r.receiver })),
      });
    } catch (err) {
      console.error("/friends/requests error:", err);
      return res.status(500).json({ error: "Ошибка сервера" });
    }
  }
);

/**
 * @swagger
 * /friends/search:
 *   get:
 *     summary: Поиск пользователя по uniqueId
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *         description: uniqueId пользователя (например, #1234)
 *     responses:
 *       200:
 *         description: Результат поиска
 */
router.get(
  "/search",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const q = String(req.query.q || "").trim();
      console.log("GET /friends/search q:", q);
      if (!q) return res.json([]);
      const user = await prisma.user.findUnique({
        where: { uniqueId: q },
        select: userPublicSelect,
      });
      return res.json(user ? [user] : []);
    } catch (err) {
      console.error("/friends/search error:", err);
      return res.status(500).json({ error: "Ошибка сервера" });
    }
  }
);

/**
 * @swagger
 * /friends/request:
 *   post:
 *     summary: Отправить запрос в друзья по uniqueId
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
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
 *                 example: #1234
 *     responses:
 *       200:
 *         description: Запрос отправлен или подтвержден
 */
router.post(
  "/request",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Не авторизован" });
      const me = req.user.id;
      const { uniqueId } = req.body ?? {};
      console.log("POST /friends/request body:", { uniqueId });
      if (typeof uniqueId !== "string" || !uniqueId.trim()) {
        return res.status(400).json({ error: "uniqueId обязателен" });
      }

      const target = await prisma.user.findUnique({
        where: { uniqueId: uniqueId.trim() },
        select: { id: true, uniqueId: true, username: true },
      });
      if (!target)
        return res.status(404).json({ error: "Пользователь не найден" });
      if (target.id === me)
        return res.status(400).json({ error: "Нельзя добавить самого себя" });

      // Если есть встречный pending запрос от target -> меняем его на ACCEPTED
      const reciprocal = await prisma.friendship.findUnique({
        where: {
          requesterId_receiverId: { requesterId: target.id, receiverId: me },
        },
      });
      if (reciprocal && reciprocal.status === "PENDING") {
        const accepted = await prisma.friendship.update({
          where: { id: reciprocal.id },
          data: { status: "ACCEPTED" },
        });
        console.log("/friends/request auto-accepted:", { id: accepted.id });
        return res.json({ success: true, action: "accepted", id: accepted.id });
      }

      // Проверяем, не друзья ли уже
      const existing = await prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: me, receiverId: target.id },
            { requesterId: target.id, receiverId: me },
          ],
        },
      });
      if (existing) {
        if (existing.status === "ACCEPTED")
          return res.status(409).json({ error: "Вы уже друзья" });
        if (existing.requesterId === me && existing.status === "PENDING")
          return res.status(409).json({ error: "Запрос уже отправлен" });
        if (existing.receiverId === me && existing.status === "PENDING")
          return res.status(409).json({ error: "Ожидает вашего ответа" });
      }

      const created = await prisma.friendship.create({
        data: { requesterId: me, receiverId: target.id },
      });
      console.log("/friends/request created:", { id: created.id });
      return res.json({ success: true, action: "requested", id: created.id });
    } catch (err) {
      console.error("/friends/request error:", err);
      return res.status(500).json({ error: "Ошибка сервера" });
    }
  }
);

/**
 * @swagger
 * /friends/accept:
 *   patch:
 *     summary: Принять запрос в друзья
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             oneOf:
 *               - required: [uniqueId]
 *               - required: [requesterId]
 *             properties:
 *               uniqueId:
 *                 type: string
 *               requesterId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Запрос принят
 */
router.patch(
  "/accept",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Не авторизован" });
      const me = req.user.id;
      const { uniqueId, requesterId } = req.body ?? {};
      console.log("PATCH /friends/accept body:", { uniqueId, requesterId });

      let otherId: number | null = null;
      if (typeof requesterId === "number") {
        otherId = requesterId;
      } else if (typeof uniqueId === "string") {
        const u = await prisma.user.findUnique({
          where: { uniqueId: uniqueId.trim() },
          select: { id: true },
        });
        otherId = u?.id ?? null;
      }
      if (!otherId)
        return res
          .status(400)
          .json({ error: "Нужно указать uniqueId или requesterId" });

      const fr = await prisma.friendship.findUnique({
        where: {
          requesterId_receiverId: { requesterId: otherId, receiverId: me },
        },
      });
      if (!fr || fr.status !== "PENDING") {
        return res.status(404).json({ error: "Запрос не найден" });
      }
      const updated = await prisma.friendship.update({
        where: { id: fr.id },
        data: { status: "ACCEPTED" },
      });
      console.log("/friends/accept updated:", { id: updated.id });
      return res.json({ success: true, id: updated.id });
    } catch (err) {
      console.error("/friends/accept error:", err);
      return res.status(500).json({ error: "Ошибка сервера" });
    }
  }
);

/**
 * @swagger
 * /friends/reject:
 *   patch:
 *     summary: Отклонить запрос в друзья
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             oneOf:
 *               - required: [uniqueId]
 *               - required: [requesterId]
 *             properties:
 *               uniqueId:
 *                 type: string
 *               requesterId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Запрос отклонен
 */
router.patch(
  "/reject",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Не авторизован" });
      const me = req.user.id;
      const { uniqueId, requesterId } = req.body ?? {};
      console.log("PATCH /friends/reject body:", { uniqueId, requesterId });

      let otherId: number | null = null;
      if (typeof requesterId === "number") {
        otherId = requesterId;
      } else if (typeof uniqueId === "string") {
        const u = await prisma.user.findUnique({
          where: { uniqueId: uniqueId.trim() },
          select: { id: true },
        });
        otherId = u?.id ?? null;
      }
      if (!otherId)
        return res
          .status(400)
          .json({ error: "Нужно указать uniqueId или requesterId" });

      const fr = await prisma.friendship.findUnique({
        where: {
          requesterId_receiverId: { requesterId: otherId, receiverId: me },
        },
      });
      if (!fr || fr.status !== "PENDING") {
        return res.status(404).json({ error: "Запрос не найден" });
      }
      const updated = await prisma.friendship.update({
        where: { id: fr.id },
        data: { status: "REJECTED" },
      });
      console.log("/friends/reject updated:", { id: updated.id });
      return res.json({ success: true, id: updated.id });
    } catch (err) {
      console.error("/friends/reject error:", err);
      return res.status(500).json({ error: "Ошибка сервера" });
    }
  }
);

/**
 * @swagger
 * /friends/{uniqueId}:
 *   delete:
 *     summary: Удалить из друзей (или отменить/очистить запросы)
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: uniqueId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Связь удалена (если была)
 */
router.delete(
  "/:uniqueId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Не авторизован" });
      const me = req.user.id;
      const uniqueId = String(req.params.uniqueId || "").trim();
      if (!uniqueId)
        return res.status(400).json({ error: "Некорректный uniqueId" });

      console.log("DELETE /friends by uniqueId:", { me, uniqueId });

      const other = await prisma.user.findUnique({
        where: { uniqueId },
        select: { id: true },
      });
      if (!other) return res.json({ success: true, removed: false });

      const fr = await prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: me, receiverId: other.id },
            { requesterId: other.id, receiverId: me },
          ],
        },
      });

      if (!fr) return res.json({ success: true, removed: false });

      await prisma.friendship.delete({ where: { id: fr.id } });
      console.log("DELETE /friends removed:", { linkId: fr.id });
      return res.json({ success: true, removed: true });
    } catch (err) {
      console.error("DELETE /friends/:uniqueId error:", err);
      return res.status(500).json({ error: "Ошибка сервера" });
    }
  }
);

export default router;
