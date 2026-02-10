import {
  createTRPCRouter,
  authenticatedProcedure,
} from "@/src/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { sendMessageToLLM } from "./service";
import { logger } from "@langfuse/shared/src/server";

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
    const conversation = await ctx.prisma.conversation.create({
      data: {
        userId: ctx.session.user.id,
      },
    });

    return {
      id: conversation.id,
      startedAt: conversation.startedAt,
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

      // Call LLM
      const assistantResponse = await sendMessageToLLM({
        messages: messageHistory,
        conversationId: input.conversationId,
        userId: ctx.session.user.id,
      });

      // Store assistant message
      const assistantMessage = await ctx.prisma.message.create({
        data: {
          conversationId: input.conversationId,
          sender: "assistant",
          content: assistantResponse,
        },
      });

      logger.info("Assistant: Stored assistant response", {
        messageId: assistantMessage.id,
        conversationId: input.conversationId,
        responseLength: assistantResponse.length,
      });

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
        },
      };
    }),
});
