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
