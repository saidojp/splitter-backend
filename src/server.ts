import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import { errorHandler } from "./middleware/errorHandler.js";
import friendsRoutes from "./routes/friends.js";

// Загружаем .env
dotenv.config();

const app = express();
app.use(express.json());

// Настройка CORS с долгим кэшированием preflight и поддержкой нескольких origin
const allowlist = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsSettings: cors.CorsOptions = {
  // ВАЖНО: при credentials: true нельзя отправлять Access-Control-Allow-Origin: "*".
  // Используем функцию, которая отражает origin запроса, чтобы корректно работать с credentials.
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    // Разрешаем запросы без origin (например, Postman, curl)
    if (!origin) return callback(null, true);

    // В non-production разрешаем все источники (отражая origin)
    if (process.env.NODE_ENV !== "production") return callback(null, true);

    // В production – только те, что в allowlist
    if (allowlist.includes(origin)) return callback(null, true);

    console.warn(`CORS blocked request from: ${origin}`);
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  maxAge: 86400, // 24 часа кэширования preflight (OPTIONS)
};

app.use(cors(corsSettings));

// Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Auth routes
app.use("/auth", authRoutes);
app.use("/user", userRoutes);
app.use("/friends", friendsRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Global error handler (must be after routes)
app.use(errorHandler);

// Запуск сервера
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

console.log("DEBUG ENV:", {
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL ? "OK" : "MISSING",
  JWT_SECRET: process.env.JWT_SECRET ? "OK" : "MISSING",
});
