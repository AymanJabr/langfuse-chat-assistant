import { api } from "@/src/utils/api";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import { Skeleton } from "@/src/components/ui/skeleton";
import { MessageSquare } from "lucide-react";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { useEffect, useRef, useState } from "react";
import { AssistantLoadingIndicator } from "./AssistantLoadingIndicator";

type ChatViewProps = {
  conversationId: string | null;
  projectId: string;
};

export function ChatView({ conversationId, projectId }: ChatViewProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const utils = api.useUtils();

  // Fetch conversation messages
  const { data: conversation, isLoading } =
    api.assistant.getConversation.useQuery(
      { conversationId: conversationId! },
      { enabled: !!conversationId },
    );

  // Send message mutation
  const sendMessage = api.assistant.sendMessage.useMutation({
    onMutate: () => {
      setIsWaitingForResponse(true);
    },
    onSuccess: () => {
      // Invalidate conversation to refetch messages
      void utils.assistant.getConversation.invalidate({
        conversationId: conversationId!,
      });
      setIsWaitingForResponse(false);
    },
    onError: () => {
      setIsWaitingForResponse(false);
    },
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]",
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [conversation?.messages, isWaitingForResponse]);

  const handleSendMessage = (content: string) => {
    if (!conversationId || !content.trim()) return;

    sendMessage.mutate({
      conversationId,
      content: content.trim(),
    });
  };

  // Empty state - no conversation selected
  if (!conversationId) {
    return (
      <div className="flex h-full flex-col items-center justify-center space-y-4 text-muted-foreground">
        <MessageSquare className="h-16 w-16 opacity-20" />
        <div className="text-center">
          <p className="text-lg font-medium">No conversation selected</p>
          <p className="text-sm">
            Select a conversation from the sidebar or create a new one
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full flex-col space-y-4 p-4">
        <Skeleton className="h-20 w-3/4" />
        <Skeleton className="ml-auto h-20 w-3/4" />
        <Skeleton className="h-20 w-3/4" />
        <Skeleton className="ml-auto h-20 w-3/4" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages Area */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
        <div className="space-y-4">
          {conversation?.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-2 py-12 text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 opacity-20" />
              <p className="text-sm">No messages yet</p>
              <p className="text-xs">Start the conversation by typing below</p>
            </div>
          ) : (
            conversation?.messages.map((message) => (
              <ChatMessage
                key={message.id}
                sender={message.sender as "user" | "assistant"}
                content={message.content}
                timestamp={message.timestamp}
              />
            ))
          )}

          {/* Loading indicator while waiting for assistant response */}
          {isWaitingForResponse && <AssistantLoadingIndicator />}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t p-4">
        <ChatInput onSend={handleSendMessage} disabled={isWaitingForResponse} />
      </div>
    </div>
  );
}
