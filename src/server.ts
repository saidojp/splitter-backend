import express from "express";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger.js";
import authRoutes from "./routes/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";

// Загружаем .env
dotenv.config();

const app = express();
app.use(express.json());

// Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Auth routes
app.use("/auth", authRoutes);

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
