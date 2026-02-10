import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import { Separator } from "@/src/components/ui/separator";
import { Badge } from "@/src/components/ui/badge";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Plus, MessageSquare } from "lucide-react";
import { api } from "@/src/utils/api";
import { useRouter } from "next/router";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/src/utils/tailwind";

type Conversation = {
  id: string;
  startedAt: Date;
  _count: {
    messages: number;
  };
};

type ConversationListProps = {
  conversations: Conversation[];
  isLoading: boolean;
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  projectId: string;
};

export function ConversationList({
  conversations,
  isLoading,
  selectedConversationId,
  onSelectConversation,
  projectId,
}: ConversationListProps) {
  const router = useRouter();
  const utils = api.useUtils();

  const createConversation = api.assistant.createConversation.useMutation({
    onSuccess: (data) => {
      // Invalidate and refetch conversations list
      void utils.assistant.listConversations.invalidate();
      // Select the new conversation
      onSelectConversation(data.id);
    },
  });

  const handleNewConversation = () => {
    createConversation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex h-full flex-col space-y-2 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with New Conversation Button */}
      <div className="p-4">
        <Button
          onClick={handleNewConversation}
          disabled={createConversation.isPending}
          className="w-full"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Conversation
        </Button>
      </div>

      <Separator />

      {/* Conversations List */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-2 py-8 text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 opacity-20" />
              <p className="text-sm">No conversations yet</p>
              <p className="text-xs">Click "New Conversation" to get started</p>
            </div>
          ) : (
            conversations.map((conversation) => (
              <Card
                key={conversation.id}
                className={cn(
                  "cursor-pointer p-3 transition-colors hover:bg-accent",
                  selectedConversationId === conversation.id &&
                    "border-primary bg-accent",
                )}
                onClick={() => onSelectConversation(conversation.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Conversation</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="text-xs">
                        {conversation._count.messages} messages
                      </Badge>
                      <span>·</span>
                      <span>
                        {formatDistanceToNow(new Date(conversation.startedAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
