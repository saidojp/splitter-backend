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
const corsSettings: cors.CorsOptions = {
  origin: "*", // Разрешаем все источники
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  maxAge: 86400, // 24 часа кэширования preflight (OPTIONS)
};

// Если задан CORS_ORIGINS и это не "*", то устанавливаем более строгие правила
if (process.env.CORS_ORIGINS && process.env.CORS_ORIGINS !== "*") {
  const corsOrigins = process.env.CORS_ORIGINS.split(",").map((origin) =>
    origin.trim()
  );

  corsSettings.origin = (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    // Разрешаем запросы без origin (например, от Postman)
    if (!origin) return callback(null, true);

    // Проверяем разрешенные origins или пропускаем всё в development
    if (corsOrigins.includes(origin) || process.env.NODE_ENV !== "production") {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  };
}

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
