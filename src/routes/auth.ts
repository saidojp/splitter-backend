import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";

const router = Router();

function generateUniqueId() {
  // Format: #1234 (4-digit code). Removed 'USER' prefix per requirement.
  return "#" + Math.floor(1000 + Math.random() * 9000);
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
 *     security: []
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
 *             email: "user@example.com"
 *             password: "123456"
 *             username: "John"
 *     responses:
 *       200:
 *         description: Успешная регистрация
 *       400:
 *         description: Неверные данные запроса
 *       409:
 *         description: Email уже используется
 *       415:
 *         description: Неверный Content-Type (нужен application/json)
 */
router.post("/register", async (req, res) => {
  const ct = String(req.headers["content-type"] || "");
  console.log("/auth/register content-type:", ct);
  console.log("/auth/register body:", req.body);
  try {
    if (!ct.includes("application/json")) {
      return res
        .status(415)
        .json({ error: "Content-Type must be application/json" });
    }

    const { email, password, username } = req.body ?? {};
    console.log("/auth/register types:", {
      email: typeof email,
      password: typeof password,
      username: typeof username,
    });

    // Soft type coercion: numbers → strings, arrays/objects are not allowed
    const emailVal =
      typeof email === "string"
        ? email
        : typeof email === "number"
        ? String(email)
        : email;
    const passwordVal =
      typeof password === "string"
        ? password
        : typeof password === "number"
        ? String(password)
        : password;
    const usernameVal =
      typeof username === "string"
        ? username
        : typeof username === "number"
        ? String(username)
        : username;

    if (
      typeof emailVal !== "string" ||
      typeof passwordVal !== "string" ||
      typeof usernameVal !== "string"
    ) {
      return res.status(400).json({
        error:
          "Invalid field types: expected strings for email, password, username",
      });
    }

    const cleanEmail = emailVal.trim().toLowerCase();
    const cleanUsername = usernameVal.trim();
    const cleanPassword = passwordVal;

    if (!cleanEmail || !cleanPassword || !cleanUsername) {
      return res
        .status(400)
        .json({ error: "Please provide email, password, and username" });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (cleanPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });
    if (existingUser) {
      return res.status(409).json({ error: "Email already in use" });
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 10);

    // Generate uniqueId with multiple attempts to avoid collisions
    let uniqueId = "";
    for (let i = 0; i < 5; i++) {
      uniqueId = generateUniqueId();
      const exists = await prisma.user.findUnique({ where: { uniqueId } });
      if (!exists) break;
      if (i === 4) {
        return res.status(500).json({ error: "Failed to generate unique ID" });
      }
    }
    console.log("/auth/register generated uniqueId:", uniqueId);

    let user;
    try {
      user = await prisma.user.create({
        data: {
          email: cleanEmail,
          password: hashedPassword,
          username: cleanUsername,
          uniqueId,
        },
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        // unique constraint conflict
        return res.status(409).json({ error: "Email already in use" });
      }
      throw e;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    console.log("/auth/register success:", { id: user.id });
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
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Авторизация пользователя
 *     tags: [Auth]
 *     security: []
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
 *             email: "user@example.com"
 *             password: "123456"
 *     responses:
 *       200:
 *         description: Успешный вход
 *       400:
 *         description: Неверные учетные данные
 *       415:
 *         description: Неверный Content-Type (нужен application/json)
 */
router.post("/login", async (req, res) => {
  console.log("/auth/login body:", req.body);
  try {
    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("application/json")) {
      return res
        .status(415)
        .json({ error: "Content-Type must be application/json" });
    }

    const { email, password } = req.body ?? {};

    const emailVal =
      typeof email === "string"
        ? email
        : typeof email === "number"
        ? String(email)
        : email;
    const passwordVal =
      typeof password === "string"
        ? password
        : typeof password === "number"
        ? String(password)
        : password;

    if (typeof emailVal !== "string" || typeof passwordVal !== "string") {
      return res.status(400).json({ error: "Invalid field types" });
    }

    const cleanEmail = emailVal.trim().toLowerCase();
    const cleanPassword = passwordVal;
    if (!cleanEmail || !cleanPassword) {
      return res.status(400).json({ error: "Please fill all fields" });
    }

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const isValid = await bcrypt.compare(cleanPassword, user.password);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    console.log("/auth/login success:", { id: user.id });
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
    res.status(500).json({ error: "Server error" });
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
 *                   example: #1234
 *                 avatarUrl:
 *                   type: string
 *                   example: https://cdn.example.com/avatars/u1.png
 *       401:
 *         description: Требуется авторизация или неверный токен
 *       404:
 *         description: Пользователь не найден
 */
router.get("/me", authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        uniqueId: true,
        avatarUrl: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(user);
  } catch (err) {
    console.error("/auth/me error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
