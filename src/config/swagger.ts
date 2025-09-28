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
        UserPublic: {
          type: "object",
          properties: {
            id: { type: "integer" },
            email: { type: "string" },
            username: { type: "string" },
            uniqueId: { type: "string" },
            avatarUrl: { type: "string", nullable: true },
          },
        },
        UserSelf: {
          allOf: [
            { $ref: "#/components/schemas/UserPublic" },
            {
              type: "object",
              properties: {},
            },
          ],
        },
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
            serviceFee: {
              type: "string",
              description: "Decimal serialized as string",
            },
            total: {
              type: "string",
              description: "Decimal serialized as string",
            },
            status: { type: "string", enum: ["ACTIVE", "CLOSED", "CANCELED"] },
            createdAt: { type: "string" },
          },
        },
        SessionParticipant: {
          type: "object",
          properties: {
            amountOwed: {
              type: "string",
              description: "Decimal serialized as string",
            },
            user: { $ref: "#/components/schemas/UserPublic" },
          },
        },
        ReceiptItem: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            price: {
              type: "string",
              description: "Decimal serialized as string",
            },
            assignedUserIds: {
              type: "array",
              items: { type: "integer" },
            },
          },
        },
        SessionDetail: {
          allOf: [
            { $ref: "#/components/schemas/Session" },
            {
              type: "object",
              properties: {
                creator: { $ref: "#/components/schemas/UserPublic" },
                group: {
                  type: "object",
                  nullable: true,
                  properties: {
                    id: { type: "integer" },
                    name: { type: "string" },
                  },
                },
                participants: {
                  type: "array",
                  items: { $ref: "#/components/schemas/SessionParticipant" },
                },
                items: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ReceiptItem" },
                },
              },
            },
          ],
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
