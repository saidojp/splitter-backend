import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import { swaggerSpec, swaggerUiMiddleware } from "./config/swagger.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Swagger docs
app.use("/api-docs", ...swaggerUiMiddleware);

// Health check
app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRoutes);

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on http://localhost:${process.env.PORT || 3000}`);
});
