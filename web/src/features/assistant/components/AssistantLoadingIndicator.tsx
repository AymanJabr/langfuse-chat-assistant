import { Bot } from "lucide-react";

export function AssistantLoadingIndicator() {
  return (
    <div className="flex w-full gap-3">
      {/* Avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Bot className="h-4 w-4" />
      </div>

      {/* Typing indicator */}
      <div className="flex items-center gap-1 rounded-lg border-secondary bg-secondary px-4 py-3">
        <span className="text-sm text-muted-foreground">
          Assistant is typing
        </span>
        <div className="ml-2 flex gap-1">
          <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
          <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
          <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
