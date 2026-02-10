import { Card, CardContent } from "@/src/components/ui/card";
import { cn } from "@/src/utils/tailwind";
import { User, Bot, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { Badge } from "@/src/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/src/components/ui/collapsible";

type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ChatMessageProps = {
  sender: "user" | "assistant";
  content: string;
  timestamp: Date;
  metadata?: {
    toolCalls?: ToolCall[];
  };
};

export function ChatMessage({
  sender,
  content,
  timestamp,
  metadata,
}: ChatMessageProps) {
  const isUser = sender === "user";
  const [toolCallsExpanded, setToolCallsExpanded] = useState(false);

  return (
    <div
      className={cn(
        "flex w-full gap-3",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {/* Avatar for assistant (left side) */}
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Bot className="h-4 w-4" />
        </div>
      )}

      {/* Message Card */}
      <div className={cn("flex max-w-[80%] flex-col gap-1")}>
        <Card
          className={cn(
            isUser
              ? "border-primary bg-primary text-primary-foreground"
              : "border-secondary bg-secondary",
          )}
        >
          <CardContent className="p-3">
            <p className="whitespace-pre-wrap text-sm">{content}</p>
          </CardContent>
        </Card>

        {/* Tool calls display (only for assistant messages) */}
        {!isUser && metadata?.toolCalls && metadata.toolCalls.length > 0 && (
          <Collapsible
            open={toolCallsExpanded}
            onOpenChange={setToolCallsExpanded}
          >
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2">
                <Badge variant="outline" className="cursor-pointer">
                  <Search className="mr-1 h-3 w-3" />
                  Used {metadata.toolCalls.length} tool(s)
                </Badge>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              {metadata.toolCalls.map((call, i) => (
                <Card key={i} className="border-muted">
                  <CardContent className="p-3 text-sm">
                    <div className="mb-2 flex items-center gap-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{call.name}</span>
                    </div>
                    {call.arguments.query && (
                      <div className="text-muted-foreground">
                        Query: &quot;{String(call.arguments.query)}&quot;
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Timestamp */}
        <span
          className={cn(
            "text-xs text-muted-foreground",
            isUser ? "text-right" : "text-left",
          )}
        >
          {formatDistanceToNow(new Date(timestamp), { addSuffix: true })}
        </span>
      </div>

      {/* Avatar for user (right side) */}
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
