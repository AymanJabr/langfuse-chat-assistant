import { Card, CardContent } from "@/src/components/ui/card";
import { cn } from "@/src/utils/tailwind";
import { User, Bot } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type ChatMessageProps = {
  sender: "user" | "assistant";
  content: string;
  timestamp: Date;
};

export function ChatMessage({ sender, content, timestamp }: ChatMessageProps) {
  const isUser = sender === "user";

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
