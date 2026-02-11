import {
  createTRPCRouter,
  authenticatedProcedure,
} from "@/src/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { sendMessageToLLM } from "./service";
import { logger } from "@langfuse/shared/src/server";

/**
 * Generate a conversation title from the first user message
 * Truncates to 50 characters and cleans up
 */
function generateConversationTitle(firstMessage: string): string {
  // Remove extra whitespace and newlines
  const cleaned = firstMessage.trim().replace(/\s+/g, " ");

  // Truncate to 50 characters
  if (cleaned.length <= 50) {
    return cleaned;
  }

  // Truncate at word boundary
  const truncated = cleaned.substring(0, 50);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > 30) {
    // If we have a good break point, use it
    return truncated.substring(0, lastSpace) + "...";
  }

  // Otherwise just truncate
  return truncated + "...";
}

export const assistantRouter = createTRPCRouter({
  // List all conversations for a user
  listConversations: authenticatedProcedure.query(async ({ ctx }) => {
    const conversations = await ctx.prisma.conversation.findMany({
      where: {
        userId: ctx.session.user.id,
      },
      orderBy: {
        startedAt: "desc",
      },
      select: {
        id: true,
        title: true,
        startedAt: true,
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    return conversations;
  }),

  // Get full message history for a conversation
  getConversation: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const conversation = await ctx.prisma.conversation.findUnique({
        where: {
          id: input.conversationId,
          userId: ctx.session.user.id,
        },
        include: {
          messages: {
            orderBy: {
              timestamp: "asc",
            },
            select: {
              id: true,
              sender: true,
              content: true,
              timestamp: true,
              metadata: true,
            },
          },
        },
      });

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      return conversation;
    }),

  // Create a new conversation
  createConversation: authenticatedProcedure.mutation(async ({ ctx }) => {
    // Count existing conversations for this user to generate number
    const conversationCount = await ctx.prisma.conversation.count({
      where: {
        userId: ctx.session.user.id,
      },
    });

    const conversationNumber = conversationCount + 1;
    const defaultTitle = `Conversation #${conversationNumber}`;

    const conversation = await ctx.prisma.conversation.create({
      data: {
        userId: ctx.session.user.id,
        title: defaultTitle,
      },
    });

    return {
      id: conversation.id,
      title: conversation.title,
      startedAt: conversation.startedAt,
    };
  }),

  // Update conversation title
  updateConversation: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        title: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Verify conversation belongs to user
      const conversation = await ctx.prisma.conversation.findUnique({
        where: {
          id: input.conversationId,
          userId: ctx.session.user.id,
        },
      });

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Update title
      const updated = await ctx.prisma.conversation.update({
        where: {
          id: input.conversationId,
        },
        data: {
          title: input.title,
        },
      });

      return {
        id: updated.id,
        title: updated.title,
      };
    }),

  // Send a message and get LLM response
  sendMessage: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        content: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      logger.info("Assistant: Processing message", {
        conversationId: input.conversationId,
        userId: ctx.session.user.id,
        contentLength: input.content.length,
      });

      // Verify conversation belongs to user
      const conversation = await ctx.prisma.conversation.findUnique({
        where: {
          id: input.conversationId,
          userId: ctx.session.user.id,
        },
      });

      if (!conversation) {
        logger.warn("Assistant: Conversation not found", {
          conversationId: input.conversationId,
          userId: ctx.session.user.id,
        });
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Store user message
      const userMessage = await ctx.prisma.message.create({
        data: {
          conversationId: input.conversationId,
          sender: "user",
          content: input.content,
        },
      });

      logger.info("Assistant: Stored user message", {
        messageId: userMessage.id,
        conversationId: input.conversationId,
      });

      // Get conversation history for context
      const messageHistory = await ctx.prisma.message.findMany({
        where: {
          conversationId: input.conversationId,
        },
        orderBy: {
          timestamp: "asc",
        },
        select: {
          sender: true,
          content: true,
        },
      });

      // Call LLM (with tool support)
      const assistantResponse = await sendMessageToLLM({
        messages: messageHistory,
        conversationId: input.conversationId,
        userId: ctx.session.user.id,
      });

      // Prepare metadata if tool calls were made
      const metadata =
        assistantResponse.toolCalls && assistantResponse.toolCalls.length > 0
          ? { toolCalls: assistantResponse.toolCalls }
          : {};

      // Store assistant message with metadata
      const assistantMessage = await ctx.prisma.message.create({
        data: {
          conversationId: input.conversationId,
          sender: "assistant",
          content: assistantResponse.content,
          metadata,
        },
      });

      logger.info("Assistant: Stored assistant response", {
        messageId: assistantMessage.id,
        conversationId: input.conversationId,
        responseLength: assistantResponse.content.length,
        hadToolCalls: !!assistantResponse.toolCalls,
        toolCallCount: assistantResponse.toolCalls?.length ?? 0,
      });

      // Auto-generate title if this is the first message
      if (messageHistory.length === 1) {
        // Only user message, so generate title from it
        const generatedTitle = generateConversationTitle(input.content);
        await ctx.prisma.conversation.update({
          where: { id: input.conversationId },
          data: { title: generatedTitle },
        });

        logger.info("Assistant: Auto-generated conversation title", {
          conversationId: input.conversationId,
          title: generatedTitle,
        });
      }

      return {
        userMessage: {
          id: userMessage.id,
          sender: userMessage.sender,
          content: userMessage.content,
          timestamp: userMessage.timestamp,
        },
        assistantMessage: {
          id: assistantMessage.id,
          sender: assistantMessage.sender,
          content: assistantMessage.content,
          timestamp: assistantMessage.timestamp,
          metadata,
        },
      };
    }),
});
