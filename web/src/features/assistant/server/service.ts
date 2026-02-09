import {
  fetchLLMCompletion,
  logger,
  traceException,
} from "@langfuse/shared/src/server";
import { TRPCError } from "@trpc/server";
import { env } from "@/src/env.mjs";

interface Message {
  sender: string;
  content: string;
}

interface SendMessageParams {
  messages: Message[];
}

export async function sendMessageToLLM(
  params: SendMessageParams,
): Promise<string> {
  try {
    // Check if assistant LLM is configured
    if (!env.ASSISTANT_LLM_API_KEY) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Assistant LLM is not configured. Please set ASSISTANT_LLM_API_KEY in environment variables.",
      });
    }

    // Build LLM connection from environment variables
    const llmConnection = {
      provider: env.ASSISTANT_LLM_PROVIDER,
      adapter: env.ASSISTANT_LLM_ADAPTER,
      secretKey: env.ASSISTANT_LLM_API_KEY,
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
      type: msg.sender === "user" ? ("user" as const) : ("assistant" as const),
      content: msg.content,
    }));

    // Call the LLM
    const completion = await fetchLLMCompletion({
      llmConnection,
      messages: formattedMessages,
      modelParams: {
        provider: env.ASSISTANT_LLM_PROVIDER,
        model: env.ASSISTANT_LLM_MODEL,
        adapter: env.ASSISTANT_LLM_ADAPTER,
      },
      streaming: false,
    });

    // Extract text from completion
    if (typeof completion === "string") {
      return completion;
    }

    // Handle object response
    if (
      completion &&
      typeof completion === "object" &&
      "content" in completion
    ) {
      return String(completion.content);
    }

    logger.error("Unexpected LLM response format", { completion });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected response format from LLM",
    });
  } catch (error) {
    traceException(error);
    logger.error("Failed to get LLM response", error);

    if (error instanceof TRPCError) {
      throw error;
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get response from LLM",
    });
  }
}
