import {
  fetchLLMCompletion,
  logger,
  traceException,
  instrumentAsync,
  type TraceSinkParams,
  ChatMessageType,
  type ChatMessage,
  LangfuseInternalTraceEnvironment,
} from "@langfuse/shared/src/server";
import { encrypt } from "@langfuse/shared/encryption";
import { TRPCError } from "@trpc/server";
import { env } from "@/src/env.mjs";
import { SpanKind } from "@opentelemetry/api";
import { randomBytes } from "crypto";
import { getLangfuseClient } from "./utils";

interface Message {
  sender: string;
  content: string;
}

interface SendMessageParams {
  messages: Message[];
  conversationId: string;
  userId: string;
}

export async function sendMessageToLLM(
  params: SendMessageParams,
): Promise<string> {
  return await instrumentAsync(
    { name: "assistant.llm.call", spanKind: SpanKind.CLIENT },
    async (span) => {
      try {
        // Check if assistant LLM is configured
        if (!env.ASSISTANT_LLM_API_KEY) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Assistant LLM is not configured. Please set ASSISTANT_LLM_API_KEY in environment variables.",
          });
        }

        // Set span attributes for observability
        span.setAttributes({
          "llm.provider": env.ASSISTANT_LLM_PROVIDER,
          "llm.model": env.ASSISTANT_LLM_MODEL,
          "llm.message_count": params.messages.length,
        });

        // Build LLM connection from environment variables
        // Note: fetchLLMCompletion expects encrypted keys (as stored in DB)
        // so we encrypt the plaintext key from environment variable
        const llmConnection = {
          provider: env.ASSISTANT_LLM_PROVIDER,
          adapter: env.ASSISTANT_LLM_ADAPTER,
          secretKey: encrypt(env.ASSISTANT_LLM_API_KEY),
          baseURL: env.ASSISTANT_LLM_BASE_URL ?? null,
          displaySecretKey: `***${env.ASSISTANT_LLM_API_KEY.slice(-4)}`,
          customModels: [],
          withDefaultModels: true,
          extraHeaders: null,
          extraHeaderKeys: [],
          config: null,
        };

        // Convert conversation history to LLM format
        const formattedMessages = params.messages.map((msg) => ({
          type:
            msg.sender === "user" ? ("user" as const) : ("assistant" as const),
          content: msg.content,
        }));

        // Log input for tracing
        logger.info("Sending message to LLM", {
          provider: env.ASSISTANT_LLM_PROVIDER,
          model: env.ASSISTANT_LLM_MODEL,
          messageCount: params.messages.length,
        });

        // Set up Langfuse tracing if configured
        let traceSinkParams: TraceSinkParams | undefined;
        if (
          env.LANGFUSE_AI_FEATURES_PUBLIC_KEY &&
          env.LANGFUSE_AI_FEATURES_SECRET_KEY &&
          env.LANGFUSE_AI_FEATURES_PROJECT_ID
        ) {
          // Initialize Langfuse client for tracing
          getLangfuseClient(
            env.LANGFUSE_AI_FEATURES_PUBLIC_KEY,
            env.LANGFUSE_AI_FEATURES_SECRET_KEY,
            env.LANGFUSE_AI_FEATURES_HOST,
          );

          traceSinkParams = {
            environment: LangfuseInternalTraceEnvironment.ChatAssistant,
            traceName: "chat-assistant",
            traceId: randomBytes(16).toString("hex"),
            targetProjectId: env.LANGFUSE_AI_FEATURES_PROJECT_ID,
            userId: params.userId,
            metadata: {
              conversationId: params.conversationId,
              messageCount: params.messages.length,
            },
          };
        }

        // Call the LLM with tracing
        const completion = await fetchLLMCompletion({
          llmConnection,
          messages: formattedMessages.map((m) => ({
            ...m,
            type: ChatMessageType.PublicAPICreated,
          })) as ChatMessage[],
          modelParams: {
            provider: env.ASSISTANT_LLM_PROVIDER,
            model: env.ASSISTANT_LLM_MODEL,
            adapter: env.ASSISTANT_LLM_ADAPTER,
          },
          streaming: false,
          traceSinkParams,
          shouldUseLangfuseAPIKey: !!traceSinkParams,
        });

        // Extract text from completion
        let responseText: string;
        if (typeof completion === "string") {
          responseText = completion;
        } else if (
          completion &&
          typeof completion === "object" &&
          "content" in completion
        ) {
          responseText = String(completion.content);
        } else {
          logger.error("Unexpected LLM response format", { completion });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unexpected response format from LLM",
          });
        }

        // Log output for tracing
        span.setAttributes({
          "llm.response_length": responseText.length,
        });

        logger.info("Received LLM response", {
          responseLength: responseText.length,
        });

        return responseText;
      } catch (error) {
        traceException(error);
        logger.error("Failed to get LLM response", {
          error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          conversationId: params.conversationId,
          userId: params.userId,
        });

        // Log to console for debugging
        console.error("❌ LLM Call Failed:");
        console.error("   Error:", error);
        console.error(
          "   Message:",
          error instanceof Error ? error.message : String(error),
        );
        console.error(
          "   Stack:",
          error instanceof Error ? error.stack : "No stack",
        );

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to get response from LLM: ${error instanceof Error ? error.message : String(error)}`,
          cause: error,
        });
      }
    },
  );
}
