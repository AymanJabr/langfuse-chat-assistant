import {
  fetchLLMCompletion,
  logger,
  traceException,
  instrumentAsync,
  type TraceSinkParams,
  ChatMessageType,
  ChatMessageRole,
  type ChatMessage,
  LangfuseInternalTraceEnvironment,
  type LLMToolDefinition,
  type LLMToolCall,
} from "@langfuse/shared/src/server";
import { encrypt } from "@langfuse/shared/encryption";
import { TRPCError } from "@trpc/server";
import { env } from "@/src/env.mjs";
import { SpanKind } from "@opentelemetry/api";
import { randomBytes } from "crypto";
import { getLangfuseClient } from "./utils";
import { searchDocumentation } from "./docs";

interface Message {
  sender: string;
  content: string;
}

interface SendMessageParams {
  messages: Message[];
  conversationId: string;
  userId: string;
}

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type SendMessageResult = {
  content: string;
  toolCalls?: ToolCall[];
};

// System prompt to establish assistant identity and context
const SYSTEM_PROMPT = `You are the Langfuse Assistant, an AI helper specifically designed to help users understand and use Langfuse.

Langfuse is an open-source LLM engineering platform for:
- Tracing LLM applications (capturing all LLM calls, chains, and agents)
- Managing prompts (versioning, deployment, A/B testing)
- Evaluating quality (LLM-as-a-Judge, human annotation)
- Testing with datasets
- Monitoring costs and performance

When users ask questions:
1. ALWAYS assume they are asking about Langfuse unless they explicitly mention another tool
2. Use the search_documentation tool to find relevant information from the Langfuse documentation
3. Provide clear, step-by-step instructions based on the documentation found
4. Be concise but thorough
5. Include specific UI locations when relevant (e.g., "Navigate to Settings → API Keys")
6. If the documentation search doesn't find relevant information, provide helpful guidance based on common patterns in LLM observability platforms

Remember: You are helping users with Langfuse specifically, not generic questions.`;

// Define the documentation search tool
const DOCUMENTATION_SEARCH_TOOL: LLMToolDefinition = {
  name: "search_documentation",
  description:
    "Search Langfuse documentation for information about features, APIs, SDKs, and how to use Langfuse. Use this tool when the user asks questions about Langfuse functionality, features, or usage.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The search query to find relevant documentation. Include key terms from the user's question.",
      },
    },
    required: ["query"],
  },
};

export async function sendMessageToLLM(
  params: SendMessageParams,
): Promise<SendMessageResult> {
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

        // Convert conversation history to LLM format with system prompt
        const formattedMessages = [
          // Add system prompt as first message
          {
            type: "system" as const,
            role: ChatMessageRole.System,
            content: SYSTEM_PROMPT,
          },
          // Then add conversation history
          ...params.messages.map((msg) => ({
            type:
              msg.sender === "user"
                ? ("user" as const)
                : ("assistant" as const),
            role:
              msg.sender === "user"
                ? ChatMessageRole.User
                : ChatMessageRole.Assistant,
            content: msg.content,
          })),
        ];

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

        // Call the LLM with tracing and tools
        const completion = await fetchLLMCompletion({
          llmConnection,
          messages: formattedMessages as ChatMessage[],
          modelParams: {
            provider: env.ASSISTANT_LLM_PROVIDER,
            model: env.ASSISTANT_LLM_MODEL,
            adapter: env.ASSISTANT_LLM_ADAPTER,
          },
          streaming: false,
          traceSinkParams,
          shouldUseLangfuseAPIKey: !!traceSinkParams,
          tools: [DOCUMENTATION_SEARCH_TOOL],
        });

        // Check if response contains tool calls
        if (
          completion &&
          typeof completion === "object" &&
          "tool_calls" in completion &&
          Array.isArray(completion.tool_calls) &&
          completion.tool_calls.length > 0
        ) {
          logger.info("LLM requested tool calls", {
            toolCallCount: completion.tool_calls.length,
          });

          // Extract tool calls
          const toolCalls: ToolCall[] = completion.tool_calls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.args as Record<string, unknown>,
          }));

          // Execute tool calls
          const toolResults = await executeToolCalls(toolCalls);

          // Get initial content
          const initialContent =
            typeof completion.content === "string"
              ? completion.content
              : Array.isArray(completion.content)
                ? completion.content
                    .filter((c: any) => c.type === "text")
                    .map((c: any) => c.text)
                    .join("\n")
                : "";

          // Call LLM again with tool results
          const followUpMessages: ChatMessage[] = [
            ...formattedMessages,
            {
              type: ChatMessageType.AssistantToolCall,
              role: ChatMessageRole.Assistant,
              content: initialContent,
              toolCalls: completion.tool_calls,
            },
            ...toolResults.map(
              (result) =>
                ({
                  type: ChatMessageType.ToolResult,
                  role: ChatMessageRole.Tool,
                  content: result.content,
                  toolCallId: result.toolCallId,
                }) as ChatMessage,
            ),
          ];

          const finalCompletion = await fetchLLMCompletion({
            llmConnection,
            messages: followUpMessages,
            modelParams: {
              provider: env.ASSISTANT_LLM_PROVIDER,
              model: env.ASSISTANT_LLM_MODEL,
              adapter: env.ASSISTANT_LLM_ADAPTER,
            },
            streaming: false,
            traceSinkParams,
            shouldUseLangfuseAPIKey: !!traceSinkParams,
          });

          const finalText =
            typeof finalCompletion === "string"
              ? finalCompletion
              : String(finalCompletion);

          logger.info("Received final LLM response after tool use", {
            responseLength: finalText.length,
          });

          return {
            content: finalText,
            toolCalls,
          };
        }

        // Extract text from completion (no tool calls)
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

        return { content: responseText };
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

/**
 * Execute tool calls and return results
 */
async function executeToolCalls(
  toolCalls: ToolCall[],
): Promise<Array<{ toolCallId: string; content: string }>> {
  const results: Array<{ toolCallId: string; content: string }> = [];

  for (const call of toolCalls) {
    try {
      if (call.name === "search_documentation") {
        const query = call.arguments.query as string;

        logger.info("Executing documentation search", { query });

        // Search documentation (increased to 5 for better context)
        const searchResults = await searchDocumentation(query, 5);

        // Format results
        const formattedResults = searchResults
          .map(
            (result, i) =>
              `${i + 1}. **${result.section}**\n\n${result.content.slice(0, 500)}${result.content.length > 500 ? "..." : ""}\n`,
          )
          .join("\n");

        const resultContent =
          searchResults.length > 0
            ? `Found ${searchResults.length} relevant documentation sections:\n\n${formattedResults}`
            : `No documentation found for query: "${query}"`;

        results.push({
          toolCallId: call.id,
          content: resultContent,
        });

        logger.info("Documentation search completed", {
          query,
          resultCount: searchResults.length,
        });
      } else {
        // Unknown tool
        logger.warn("Unknown tool requested", { toolName: call.name });
        results.push({
          toolCallId: call.id,
          content: `Error: Unknown tool "${call.name}"`,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : "";

      logger.error("Tool execution failed", {
        toolName: call.name,
        error: errorMessage,
        stack: errorStack,
      });

      // Also log to console for debugging
      console.error("❌ Tool execution error:", {
        tool: call.name,
        query: call.arguments,
        error: errorMessage,
        stack: errorStack,
      });

      results.push({
        toolCallId: call.id,
        content: `Error executing tool: ${errorMessage}`,
      });
    }
  }

  return results;
}
