import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Receipt Splitter API",
      version: "1.0.0",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        Friendship: {
          type: "object",
          properties: {
            id: { type: "integer" },
            requesterId: { type: "integer" },
            receiverId: { type: "integer" },
            status: {
              type: "string",
              enum: ["PENDING", "ACCEPTED", "REJECTED", "BLOCKED"],
            },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
        },
        Group: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            ownerId: { type: "integer" },
            createdAt: { type: "string" },
          },
        },
        Session: {
          type: "object",
          properties: {
            id: { type: "integer" },
            creatorId: { type: "integer" },
            groupId: { type: "integer", nullable: true },
            receiptImageUrl: { type: "string", nullable: true },
            serviceFee: { type: "number" },
            total: { type: "number" },
            status: { type: "string", enum: ["ACTIVE", "CLOSED", "CANCELED"] },
            createdAt: { type: "string" },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ["./src/routes/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
export const swaggerUiMiddleware = [
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec),
];
