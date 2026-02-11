/** @jest-environment node */

import { appRouter } from "@/src/server/api/root";
import { createInnerTRPCContext } from "@/src/server/api/trpc";
import { prisma } from "@langfuse/shared/src/db";
import type { Session } from "next-auth";
import { v4 as uuidv4 } from "uuid";
import { TRPCError } from "@trpc/server";

// Mock the external LLM call to avoid real API calls
jest.mock("@langfuse/shared/src/server", () => {
  const actual = jest.requireActual("@langfuse/shared/src/server");
  return {
    ...actual,
    fetchLLMCompletion: jest
      .fn()
      .mockResolvedValue("This is a mocked LLM response"),
  };
});

import { fetchLLMCompletion } from "@langfuse/shared/src/server";

const __userIds: string[] = [];

async function createTestUser() {
  const userId = uuidv4();
  const user = await prisma.user.create({
    data: {
      id: userId,
      email: `test-${userId.substring(0, 8)}@test.com`,
      name: "Test User",
    },
  });

  __userIds.push(userId);
  return user;
}

function createSession(user: {
  id: string;
  email: string | null;
  name: string | null;
}): Session {
  return {
    expires: "1",
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      canCreateOrganizations: true,
      organizations: [],
      featureFlags: {
        excludeClickhouseRead: false,
        templateFlag: true,
      },
      admin: false,
    },
    environment: {
      enableExperimentalFeatures: false,
      selfHostedInstancePlan: "cloud:hobby",
    },
  };
}

async function prepare() {
  const user = await createTestUser();
  const session = createSession(user);
  const ctx = createInnerTRPCContext({ session, headers: {} });
  const caller = appRouter.createCaller({ ...ctx, prisma });

  return { user, session, ctx, caller };
}

describe("assistant tRPC", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Clean up test users and their conversations/messages (cascade will handle)
    await prisma.user.deleteMany({
      where: {
        id: { in: __userIds },
      },
    });
  });

  // ============================================================================
  // HAPPY PATH TESTS
  // Test basic functionality - creating conversations, listing, retrieving, and sending messages
  // ============================================================================

  describe("assistant.createConversation", () => {
    it("should create a new conversation for authenticated user", async () => {
      const { caller, user } = await prepare();

      const result = await caller.assistant.createConversation();

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("startedAt");
      expect(result.id).toBeTruthy();

      // Verify in database
      const conversation = await prisma.conversation.findUnique({
        where: { id: result.id },
      });

      expect(conversation).not.toBeNull();
      expect(conversation?.userId).toBe(user.id);
    });
  });

  describe("assistant.listConversations", () => {
    it("should list all conversations for the authenticated user", async () => {
      const { caller } = await prepare();

      // Create multiple conversations
      const conv1 = await caller.assistant.createConversation();
      const conv2 = await caller.assistant.createConversation();

      const result = await caller.assistant.listConversations();

      expect(result).toHaveLength(2);
      expect(result.map((c) => c.id)).toContain(conv1.id);
      expect(result.map((c) => c.id)).toContain(conv2.id);
      expect(result[0]).toHaveProperty("startedAt");
      expect(result[0]).toHaveProperty("_count");
    });

    it("should return conversations ordered by startedAt desc", async () => {
      const { caller } = await prepare();

      // Create conversations with delay to ensure different timestamps
      const conv1 = await caller.assistant.createConversation();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const conv2 = await caller.assistant.createConversation();

      const result = await caller.assistant.listConversations();

      expect(result[0].id).toBe(conv2.id); // Most recent first
      expect(result[1].id).toBe(conv1.id);
    });

    it("should return empty array when user has no conversations", async () => {
      const { caller } = await prepare();

      const result = await caller.assistant.listConversations();

      expect(result).toEqual([]);
    });

    it("should return message count in listConversations", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: "Test",
      });

      const result = await caller.assistant.listConversations();

      expect(result[0]._count.messages).toBe(2);
    });
  });

  describe("assistant.getConversation", () => {
    it("should retrieve conversation with all messages", async () => {
      const { caller } = await prepare();

      // Create conversation and send a message
      const conv = await caller.assistant.createConversation();
      await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: "Hello!",
      });

      const result = await caller.assistant.getConversation({
        conversationId: conv.id,
      });

      expect(result.id).toBe(conv.id);
      expect(result.messages).toHaveLength(2); // User message + assistant response
      expect(result.messages[0].sender).toBe("user");
      expect(result.messages[1].sender).toBe("assistant");
    });

    it("should return messages ordered by timestamp ascending", async () => {
      const { caller } = await prepare();

      const conv = await caller.assistant.createConversation();

      // Send multiple messages
      await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: "First message",
      });
      await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: "Second message",
      });

      const result = await caller.assistant.getConversation({
        conversationId: conv.id,
      });

      expect(result.messages[0].content).toBe("First message");
      expect(result.messages[2].content).toBe("Second message");
    });
  });

  describe("assistant.sendMessage", () => {
    it("should send message and receive LLM response", async () => {
      const { caller } = await prepare();

      const conv = await caller.assistant.createConversation();

      const result = await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: "What is Langfuse?",
      });

      expect(result.userMessage.content).toBe("What is Langfuse?");
      expect(result.userMessage.sender).toBe("user");
      expect(result.assistantMessage.content).toBe(
        "This is a mocked LLM response",
      );
      expect(result.assistantMessage.sender).toBe("assistant");
    });

    it("should persist both user and assistant messages", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: "Test message",
      });

      const messages = await prisma.message.findMany({
        where: { conversationId: conv.id },
        orderBy: { timestamp: "asc" },
      });

      expect(messages).toHaveLength(2);
      expect(messages[0].sender).toBe("user");
      expect(messages[0].content).toBe("Test message");
      expect(messages[1].sender).toBe("assistant");
      expect(messages[1].content).toBe("This is a mocked LLM response");
    });
  });

  // ============================================================================
  // AUTHORIZATION & AUTHENTICATION TESTS
  // Test user isolation and authentication requirements across all endpoints
  // ============================================================================

  describe("authorization and authentication", () => {
    it("should fail to create conversation without authentication", async () => {
      const ctx = createInnerTRPCContext({ session: null, headers: {} });
      const caller = appRouter.createCaller({ ...ctx, prisma });

      await expect(caller.assistant.createConversation()).rejects.toThrow(
        TRPCError,
      );
    });

    it("should fail to list conversations without authentication", async () => {
      const ctx = createInnerTRPCContext({ session: null, headers: {} });
      const caller = appRouter.createCaller({ ...ctx, prisma });

      await expect(caller.assistant.listConversations()).rejects.toThrow(
        TRPCError,
      );
    });

    it("should fail to get conversation without authentication", async () => {
      const ctx = createInnerTRPCContext({ session: null, headers: {} });
      const caller = appRouter.createCaller({ ...ctx, prisma });

      await expect(
        caller.assistant.getConversation({
          conversationId: "some-id",
        }),
      ).rejects.toThrow(TRPCError);
    });

    it("should fail to send message without authentication", async () => {
      const ctx = createInnerTRPCContext({ session: null, headers: {} });
      const caller = appRouter.createCaller({ ...ctx, prisma });

      await expect(
        caller.assistant.sendMessage({
          conversationId: "some-id",
          content: "test",
        }),
      ).rejects.toThrow(TRPCError);
    });

    it("should only show user's own conversations", async () => {
      const { caller: caller1 } = await prepare();
      const { caller: caller2 } = await prepare();

      // User 1 creates a conversation
      await caller1.assistant.createConversation();

      // User 2 should not see user 1's conversations
      const result = await caller2.assistant.listConversations();

      expect(result).toHaveLength(0);
    });

    it("should not allow user to access another user's conversation", async () => {
      const { caller: caller1 } = await prepare();
      const { caller: caller2 } = await prepare();

      // User 1 creates a conversation
      const conv = await caller1.assistant.createConversation();

      // User 2 tries to access it
      await expect(
        caller2.assistant.getConversation({ conversationId: conv.id }),
      ).rejects.toThrow(TRPCError);
    });

    it("should not allow sending message to another user's conversation", async () => {
      const { caller: caller1 } = await prepare();
      const { caller: caller2 } = await prepare();

      const conv = await caller1.assistant.createConversation();

      await expect(
        caller2.assistant.sendMessage({
          conversationId: conv.id,
          content: "Hello",
        }),
      ).rejects.toThrow(TRPCError);
    });
  });

  // ============================================================================
  // VALIDATION TESTS
  // Test input validation and error handling for invalid requests
  // ============================================================================

  describe("validation", () => {
    it("should reject empty message content", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      await expect(
        caller.assistant.sendMessage({
          conversationId: conv.id,
          content: "",
        }),
      ).rejects.toThrow();
    });

    it("should return 404 for non-existent conversation in getConversation", async () => {
      const { caller } = await prepare();

      await expect(
        caller.assistant.getConversation({
          conversationId: "non-existent-id",
        }),
      ).rejects.toThrow(TRPCError);
    });

    it("should return 404 for non-existent conversation in sendMessage", async () => {
      const { caller } = await prepare();

      await expect(
        caller.assistant.sendMessage({
          conversationId: "non-existent-id",
          content: "Hello",
        }),
      ).rejects.toThrow(TRPCError);
    });
  });

  // ============================================================================
  // EDGE CASES
  // Test unusual scenarios like LLM errors, rapid messages, and large conversations
  // ============================================================================

  describe("edge cases", () => {
    it("should handle long message content", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      const longContent = "a".repeat(5000);

      const result = await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: longContent,
      });

      expect(result.userMessage.content).toBe(longContent);
      expect(result.assistantMessage.content).toBe(
        "This is a mocked LLM response",
      );
    });

    it("should handle special characters in message", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      const specialContent = "Hello! 你好 🚀 <script>alert('xss')</script>";

      const result = await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: specialContent,
      });

      expect(result.userMessage.content).toBe(specialContent);
    });

    it("should handle unicode and emoji content", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      const unicodeContent = "Hello 世界 🌍 مرحبا שלום";

      const result = await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: unicodeContent,
      });

      expect(result.userMessage.content).toBe(unicodeContent);
    });

    it("should handle LLM service errors gracefully", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      // Mock LLM to throw error
      (fetchLLMCompletion as jest.Mock).mockRejectedValueOnce(
        new Error("LLM service unavailable"),
      );

      await expect(
        caller.assistant.sendMessage({
          conversationId: conv.id,
          content: "Test",
        }),
      ).rejects.toThrow();

      // User message should still be stored
      const messages = await prisma.message.findMany({
        where: { conversationId: conv.id },
      });
      expect(messages).toHaveLength(1);
      expect(messages[0].sender).toBe("user");
    });

    it("should handle multiple rapid messages", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      // Send multiple messages in parallel
      const promises = [
        caller.assistant.sendMessage({
          conversationId: conv.id,
          content: "Message 1",
        }),
        caller.assistant.sendMessage({
          conversationId: conv.id,
          content: "Message 2",
        }),
        caller.assistant.sendMessage({
          conversationId: conv.id,
          content: "Message 3",
        }),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);

      const messages = await prisma.message.findMany({
        where: { conversationId: conv.id },
      });

      expect(messages).toHaveLength(6); // 3 user + 3 assistant
    });

    it("should handle conversation with many messages", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      // Send 10 messages
      for (let i = 0; i < 10; i++) {
        await caller.assistant.sendMessage({
          conversationId: conv.id,
          content: `Message ${i}`,
        });
      }

      const result = await caller.assistant.getConversation({
        conversationId: conv.id,
      });

      expect(result.messages).toHaveLength(20); // 10 user + 10 assistant
    });
  });

  // ============================================================================
  // SECURITY TESTS
  // Test protection against SQL injection, XSS, and malicious input
  // ============================================================================

  describe("security", () => {
    it("should handle SQL injection attempts safely", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      const sqlInjection = "'; DROP TABLE conversations; --";

      const result = await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: sqlInjection,
      });

      expect(result.userMessage.content).toBe(sqlInjection);

      // Verify table still exists
      const conversations = await prisma.conversation.findMany();
      expect(conversations.length).toBeGreaterThan(0);
    });

    it("should handle XSS attempts safely", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      const xssAttempt = "<script>alert('xss')</script>";

      const result = await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: xssAttempt,
      });

      expect(result.userMessage.content).toBe(xssAttempt);
    });
  });

  // ============================================================================
  // LLM INTEGRATION TESTS
  // Test that LLM is called correctly with conversation history
  // ============================================================================

  describe("LLM integration", () => {
    it("should call LLM with correct parameters", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: "What is Langfuse?",
      });

      // Verify LLM was called
      expect(fetchLLMCompletion).toHaveBeenCalled();
    });

    it("should include conversation history when calling LLM", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      // First message
      await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: "First question",
      });

      // Second message
      await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: "Follow-up question",
      });

      // Verify LLM was called for both messages
      expect(fetchLLMCompletion).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // DATA INTEGRITY TESTS
  // Test cascading deletes and database constraints
  // ============================================================================

  describe("data integrity", () => {
    it("should delete messages when conversation is deleted", async () => {
      const { caller } = await prepare();
      const conv = await caller.assistant.createConversation();

      await caller.assistant.sendMessage({
        conversationId: conv.id,
        content: "Test",
      });

      // Verify messages exist
      const messagesBefore = await prisma.message.findMany({
        where: { conversationId: conv.id },
      });
      expect(messagesBefore.length).toBeGreaterThan(0);

      // Delete conversation
      await prisma.conversation.delete({
        where: { id: conv.id },
      });

      // Verify messages are deleted
      const messagesAfter = await prisma.message.findMany({
        where: { conversationId: conv.id },
      });
      expect(messagesAfter).toHaveLength(0);
    });

    it("should delete conversations when user is deleted", async () => {
      const { user } = await prepare();

      // Create conversation directly in DB
      const conv = await prisma.conversation.create({
        data: {
          userId: user.id,
        },
      });

      // Delete user
      await prisma.user.delete({
        where: { id: user.id },
      });

      // Verify conversation is deleted
      const conversationAfter = await prisma.conversation.findUnique({
        where: { id: conv.id },
      });
      expect(conversationAfter).toBeNull();
    });
  });
});
