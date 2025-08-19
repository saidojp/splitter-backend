import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";

const router = Router();

function generateUniqueId() {
  return "USER#" + Math.floor(1000 + Math.random() * 9000);
}

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Авторизация и регистрация пользователей
 */

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Регистрация нового пользователя
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - username
 *             properties:
 *               email:
 *                 type: string
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 example: 123456
 *               username:
 *                 type: string
 *                 example: John
 *           example:
 *             email: user@example.com
 *             password: 123456
 *             username: John
 *     responses:
 *       200:
 *         description: Успешная регистрация
 */
router.post("/register", async (req, res) => {
  console.log("/auth/register body:", req.body);
  try {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
      return res.status(400).json({ error: "Заполните все поля" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: "Email уже используется" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const uniqueId = generateUniqueId();

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, username, uniqueId },
    });

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        uniqueId: user.uniqueId,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Авторизация пользователя
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 example: 123456
 *           example:
 *             email: user@example.com
 *             password: 123456
 *     responses:
 *       200:
 *         description: Успешный вход
 */
router.post("/login", async (req, res) => {
  console.log("/auth/login body:", req.body);
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Заполните все поля" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: "Неверный email или пароль" });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: "Неверный email или пароль" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        uniqueId: user.uniqueId,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Получение информации о текущем пользователе
 *     description: Возвращает профиль пользователя по ID из JWT токена.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Информация о пользователе
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                   example: 1
 *                 email:
 *                   type: string
 *                   example: user@example.com
 *                 username:
 *                   type: string
 *                   example: John
 *                 uniqueId:
 *                   type: string
 *                   example: USER#1234
 *       401:
 *         description: Требуется авторизация или неверный токен
 *       404:
 *         description: Пользователь не найден
 */
router.get("/me", authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Не авторизован" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, username: true, uniqueId: true },
    });

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    return res.json(user);
  } catch (err) {
    console.error("/auth/me error:", err);
    return res.status(500).json({ error: "Ошибка сервера" });
  }
});

export default router;
