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
        ReceiptLine: {
          type: "object",
          properties: {
            id: { type: "integer" },
            lineIndex: { type: "integer" },
            linesCount: { type: "integer" },
            itemsCount: { type: "integer" },
            rawLine: { type: "string" },
            required: [
              "status",
              "translationApplied",
              "linesCount",
              "itemsCount",
            ],
            descriptionOriginal: { type: "string", nullable: true },
            description: {
              type: "string",
              nullable: true,
              description: "Translated description if targetLanguage differs",
            },
            quantity: { type: "number", nullable: true },
            unitPrice: { type: "number", nullable: true },
            lineTotal: { type: "number", nullable: true },
            currency: { type: "string", nullable: true },
            confidence: { type: "number", nullable: true },
            translationConfidence: { type: "number", nullable: true },
          },
          required: ["id", "lineIndex", "rawLine", "isItem"],
        },
        ReceiptParse: {
          type: "object",
          properties: {
            id: { type: "integer" },
            sessionId: { type: "integer" },
            linesCount: 18,
            itemsCount: 12,
            status: {
              type: "string",
              enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
            },
            provider: { type: "string", nullable: true },
            model: { type: "string", nullable: true },
            targetLanguage: { type: "string", nullable: true },
            detectedLanguage: { type: "string", nullable: true },
            translationApplied: { type: "boolean" },
            confidence: { type: "number", nullable: true },
            errorMessage: { type: "string", nullable: true },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
            lines: {
              type: "array",
              items: { $ref: "#/components/schemas/ReceiptLine" },
            },
          },
          required: [
            "id",
            "sessionId",
            "status",
            "translationApplied",
            "createdAt",
            "updatedAt",
          ],
        },
        GroupMemberEntry: {
          type: "object",
          properties: {
            id: { type: "integer" },
            uniqueId: { type: "string" },
            username: { type: "string" },
            avatarUrl: { type: "string", nullable: true },
            role: { type: "string", enum: ["owner", "member"] },
          },
          required: ["id", "uniqueId", "username", "role"],
        },
        GroupMembersResponse: {
          type: "object",
          properties: {
            group: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
              },
              required: ["id", "name"],
            },
            role: { type: "string", enum: ["owner", "member"] },
            members: {
              type: "array",
              items: { $ref: "#/components/schemas/GroupMemberEntry" },
            },
          },
          required: ["group", "role", "members"],
        },
        GroupListItem: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            ownerId: { type: "integer" },
            createdAt: { type: "string" },
            counts: {
              type: "object",
              properties: {
                members: { type: "integer" },
                sessions: { type: "integer" },
              },
              required: ["members", "sessions"],
            },
            members: {
              type: "array",
              items: { $ref: "#/components/schemas/GroupMemberEntry" },
            },
          },
          required: ["id", "name", "ownerId", "createdAt", "counts", "members"],
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
            serviceFee: { type: "number" },
            total: { type: "number" },
            status: { type: "string", enum: ["ACTIVE", "CLOSED", "CANCELED"] },
            createdAt: { type: "string" },
          },
        },
        ReceiptItem: {
          type: "object",
          properties: {
            id: { type: "integer" },
            sessionId: { type: "integer" },
            name: { type: "string" },
            price: { type: "number" },
          },
          required: ["id", "sessionId", "name", "price"],
        },
        SessionDetail: {
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
            parse: {
              type: "object",
              nullable: true,
              properties: {
                status: {
                  type: "string",
                  enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
                },
                detectedLanguage: { type: "string", nullable: true },
                targetLanguage: { type: "string", nullable: true },
                translationApplied: { type: "boolean" },
                provider: { type: "string", nullable: true },
                model: { type: "string", nullable: true },
                errorMessage: { type: "string", nullable: true },
              },
              required: ["status", "translationApplied"],
            },
            items: {
              type: "array",
              items: { $ref: "#/components/schemas/ReceiptItem" },
            },
          },
          required: [
            "id",
            "creatorId",
            "serviceFee",
            "total",
            "status",
            "createdAt",
            "items",
          ],
          example: {
            id: 42,
            creatorId: 1,
            groupId: null,
            receiptImageUrl: "https://cdn.example.com/receipts/42.jpg",
            serviceFee: 0,
            total: 15.4,
            status: "ACTIVE",
            createdAt: "2025-10-05T10:00:00.000Z",
            parse: {
              status: "COMPLETED",
              detectedLanguage: "uz",
              targetLanguage: "ja",
              translationApplied: true,
              provider: "gemini",
              model: "gemini-1.5-flash",
            },
            items: [
              {
                id: 1001,
                sessionId: 42,
                name: "コカ・コーラ 0.5L",
                price: 3.0,
              },
              { id: 1002, sessionId: 42, name: "黒パン", price: 5.2 },
              { id: 1003, sessionId: 42, name: "砂糖 1kg", price: 7.2 },
            ],
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
