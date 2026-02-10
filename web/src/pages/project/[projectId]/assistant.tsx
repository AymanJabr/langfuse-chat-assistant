import { useRouter } from "next/router";
import Page from "@/src/components/layouts/page";
import { api } from "@/src/utils/api";
import { useState } from "react";
import { ConversationList } from "@/src/features/assistant/components/ConversationList";
import { ChatView } from "@/src/features/assistant/components/ChatView";
import { ResizableDesktopLayout } from "@/src/components/layouts/ResizableDesktopLayout";

export default function Assistant() {
  const router = useRouter();
  const projectId = router.query.projectId as string;
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  // Fetch conversations list
  const { data: conversations, isLoading } =
    api.assistant.listConversations.useQuery(undefined, {
      enabled: !!projectId,
    });

  return (
    <Page
      headerProps={{
        title: "Assistant",
        help: {
          description:
            "Chat with the Langfuse Assistant to get help understanding and using Langfuse.",
          href: "https://langfuse.com/docs",
        },
      }}
    >
      <ResizableDesktopLayout
        sidebarContent={
          <ConversationList
            conversations={conversations ?? []}
            isLoading={isLoading}
            selectedConversationId={selectedConversationId}
            onSelectConversation={setSelectedConversationId}
            projectId={projectId}
          />
        }
        mainContent={
          <ChatView
            conversationId={selectedConversationId}
            projectId={projectId}
          />
        }
        open={true}
        sidebarPosition="left"
        defaultSidebarSize={30}
        defaultMainSize={70}
        autoSaveId="assistant-layout"
      />
    </Page>
  );
}
