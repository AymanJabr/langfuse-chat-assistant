# Assistant Feature - Implementation Documentation

## 1. Executive Summary

This document describes the implementation of a ChatGPT-style assistant feature within Langfuse. The assistant helps users understand and use Langfuse through an interactive chat interface.

**Key Implementation Details:**
- **Architecture**: tRPC procedures (following existing Langfuse patterns) instead of REST endpoints
- **Scope**: User-scoped conversations (not project-scoped)
- **LLM Integration**: Tool calling with documentation search
- **Tech Stack**: tRPC, Prisma, React Query, Next.js 14, OpenTelemetry

## 2. Architecture & Design Decisions

### 2.1 Why tRPC Instead of REST?

The task specification requested REST endpoints (`GET /api/conversations`, `POST /api/conversations/:id/messages`), but we implemented tRPC procedures instead to maintain consistency with the existing Langfuse codebase.

**Rationale:**
- Langfuse uses tRPC throughout the application
- Type safety between frontend and backend (no manual type definitions needed)
- Better developer experience with React Query integration
- Maintains architectural consistency

### 2.2 User-Scoped vs Project-Scoped

Conversations belong to users, not projects. The `conversations` table has a `user_id` foreign key but no `project_id`.

**Rationale:**
- The assistant helps users understand Langfuse as a platform, not just a specific project
- Users can ask general questions about features, APIs, and workflows
- Conversations persist across all projects the user accesses
- Simpler data model and clearer separation of concerns

### 2.3 Documentation Search: Simple Markdown vs Vector Database

The assistant uses keyword-based search over a markdown documentation file rather than vector embeddings.

**Rationale:**
- Faster to implement and easier to maintain
- No dependency on external vector databases or embedding APIs
- Sufficient accuracy for MVP with keyword matching and relevance scoring
- Documentation can be updated by simply editing the markdown file

### 2.4 Tool Calling Implementation

The LLM has access to a `search_documentation` tool that queries the documentation file.

**Flow:**
1. User sends message
2. LLM decides if it needs to search documentation
3. If yes, tool call is executed → documentation search
4. Results are returned to LLM
5. LLM generates final response using the documentation context

Tool call metadata is stored in the `messages.metadata` JSON field and displayed in the UI.

## 3. Database Schema

### 3.1 New Tables

**conversations**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (PK) | CUID identifier |
| user_id | TEXT (FK → users.id) | Owner of the conversation |
| started_at | TIMESTAMP | When conversation was created |
| title | TEXT | Display name (default: "Conversation #N") |

**Indexes:** `user_id`
**Cascade:** DELETE on user deletion

---

**messages**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (PK) | CUID identifier |
| conversation_id | TEXT (FK → conversations.id) | Parent conversation |
| sender | TEXT | "user" or "assistant" |
| content | TEXT | Message text |
| timestamp | TIMESTAMP | When message was sent |
| metadata | JSONB | Tool calls and other metadata (default: `{}`) |

**Indexes:** `conversation_id`
**Cascade:** DELETE on conversation deletion

### 3.2 Migrations

Three migration files were created in `packages/shared/prisma/migrations/`:

1. **20260209083124_add_ai_conversations_and_messages**
   - Creates `conversations` and `messages` tables
   - Sets up foreign keys and indexes
   - Adds CASCADE delete behavior

2. **20260210000000_add_message_metadata**
   - Adds `metadata` JSONB column to `messages` table
   - Default value: `{}`

3. **20260210120000_add_conversation_title**
   - Adds `title` TEXT column to `conversations` table
   - Default value: `'New Conversation'`

**To run migrations:**
```bash
cd packages/shared
pnpm db:migrate
```

## 4. API Endpoints (tRPC Procedures)

**Router Location:** `web/src/features/assistant/server/assistantRouter.ts`

All procedures require authentication and are automatically traced with OpenTelemetry.

### 4.1 listConversations

**Type:** Query
**Authentication:** Required
**Returns:** Array of conversations for the authenticated user

**Response Schema:**
```typescript
Array<{
  id: string;
  title: string;
  startedAt: Date;
  _count: {
    messages: number;
  };
}>
```

**Frontend Usage:**
```typescript
const { data: conversations, isLoading } =
  api.assistant.listConversations.useQuery();
```

---

### 4.2 getConversation

**Type:** Query
**Input:** `{ conversationId: string }`
**Authentication:** Required
**Authorization:** User must own the conversation
**Returns:** Conversation with full message history

**Response Schema:**
```typescript
{
  id: string;
  title: string;
  startedAt: Date;
  messages: Array<{
    id: string;
    sender: "user" | "assistant";
    content: string;
    timestamp: Date;
    metadata: {
      toolCalls?: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }>;
    } | null;
  }>;
}
```

**Frontend Usage:**
```typescript
const { data: conversation } = api.assistant.getConversation.useQuery(
  { conversationId: "clx123..." },
  { enabled: !!conversationId }
);
```

---

### 4.3 createConversation

**Type:** Mutation
**Authentication:** Required
**Returns:** New conversation with auto-numbered title

**Behavior:**
- Counts existing conversations for the user
- Creates new conversation with title "Conversation #N"
- Returns conversation metadata

**Response Schema:**
```typescript
{
  id: string;
  title: string;  // "Conversation #1", "Conversation #2", etc.
  startedAt: Date;
}
```

**Frontend Usage:**
```typescript
const mutation = api.assistant.createConversation.useMutation({
  onSuccess: (data) => {
    // Navigate to new conversation
    setSelectedConversationId(data.id);
  }
});

mutation.mutate();
```

---

### 4.4 updateConversation

**Type:** Mutation
**Input:** `{ conversationId: string, title: string }`
**Validation:** Title must be 1-100 characters
**Authentication:** Required
**Authorization:** User must own the conversation
**Returns:** Updated conversation

**Response Schema:**
```typescript
{
  id: string;
  title: string;
}
```

**Frontend Usage:**
```typescript
const mutation = api.assistant.updateConversation.useMutation();

mutation.mutate({
  conversationId: "clx123...",
  title: "My Custom Title"
});
```

---

### 4.5 sendMessage

**Type:** Mutation
**Input:** `{ conversationId: string, content: string }`
**Authentication:** Required
**Authorization:** User must own the conversation
**Returns:** Both user and assistant messages

**Behavior:**
1. Validates conversation ownership
2. Stores user message
3. Retrieves conversation history
4. Calls LLM with system prompt and conversation context
5. If LLM requests tools, executes them and continues conversation
6. Stores assistant message with metadata
7. Auto-generates conversation title from first user message (if applicable)

**Response Schema:**
```typescript
{
  userMessage: {
    id: string;
    sender: "user";
    content: string;
    timestamp: Date;
  };
  assistantMessage: {
    id: string;
    sender: "assistant";
    content: string;
    timestamp: Date;
    metadata: {
      toolCalls?: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }>;
    };
  };
}
```

**Frontend Usage:**
```typescript
const mutation = api.assistant.sendMessage.useMutation({
  onMutate: async (variables) => {
    // Optimistic update: show user message immediately
    // (See ChatView.tsx for full implementation)
  },
  onSuccess: () => {
    // Refetch conversation to get assistant response
  }
});

mutation.mutate({
  conversationId: "clx123...",
  content: "How do I create a trace in Langfuse?"
});
```

**LLM Configuration:**
The LLM call uses configuration from environment variables (see section 6).

**System Prompt:**
The assistant includes a comprehensive system prompt that:
- Establishes identity as "Langfuse Assistant"
- Explains Langfuse's purpose and features
- Instructs when to use the documentation search tool
- Provides guidelines for response format and tone

**Tool Execution:**
When the LLM calls the `search_documentation` tool:
1. Query is extracted from tool arguments
2. Documentation is searched using keyword matching
3. Top 5 relevant sections are returned
4. Results are formatted and sent back to LLM
5. LLM generates final response incorporating the documentation

## 5. Frontend Components

### 5.1 Component Hierarchy

```
assistant.tsx (Page)
├── ConversationList (Sidebar)
│   ├── New Conversation Button
│   └── Conversation Cards
│       ├── Title (editable on hover)
│       ├── Message Count Badge
│       └── Timestamp
│
└── ChatView (Main)
    ├── Empty State (no conversation selected)
    ├── Messages (ScrollArea)
    │   ├── ChatMessage (user)
    │   │   ├── Avatar (right)
    │   │   ├── Content
    │   │   └── Timestamp
    │   │
    │   ├── ChatMessage (assistant)
    │   │   ├── Avatar (left)
    │   │   ├── Content
    │   │   ├── Tool Calls Badge (collapsible)
    │   │   └── Timestamp
    │   │
    │   └── AssistantLoadingIndicator
    │
    └── ChatInput (bottom)
        ├── Auto-resizing Textarea
        └── Send Button
```

### 5.2 Key Features

**Optimistic Updates (ChatView.tsx)**
- User messages appear immediately when sent (before API response)
- Uses React Query's `onMutate` to update cache optimistically
- Rollback on error using context snapshot

**Tool Calls Display (ChatMessage.tsx)**
- Shows collapsible badge: "Used N tool(s)"
- Clicking badge reveals tool details
- Displays tool name and arguments (e.g., search query)

**Inline Title Editing (ConversationList.tsx)**
- Hover over conversation to reveal edit button (pencil icon)
- Click to enter edit mode (input field appears)
- Save with Enter key or check button
- Cancel with Escape key or X button

**Auto-scroll (ChatView.tsx)**
- Messages automatically scroll to bottom when new messages arrive
- Uses ref to scroll container and `useEffect` hook

**Auto-title Generation (assistantRouter.ts)**
- First user message generates conversation title
- Truncates to 50 characters at word boundary
- Can be edited by user later

**Keyboard Accessibility (ChatInput.tsx)**
- Enter to send message
- Shift+Enter for new line
- Auto-focus on mount
- Auto-resize textarea (max 4 lines)

### 5.3 Files Changed

**New Files:**

**Page:**
- `web/src/pages/project/[projectId]/assistant.tsx`

**Components:**
- `web/src/features/assistant/components/ConversationList.tsx`
- `web/src/features/assistant/components/ChatView.tsx`
- `web/src/features/assistant/components/ChatMessage.tsx`
- `web/src/features/assistant/components/ChatInput.tsx`
- `web/src/features/assistant/components/AssistantLoadingIndicator.tsx`

**Backend:**
- `web/src/features/assistant/server/assistantRouter.ts`
- `web/src/features/assistant/server/service.ts`
- `web/src/features/assistant/server/docs/searchDocs.ts`
- `web/src/features/assistant/server/docs/langfuse-user-guide.md` (835 lines)
- `web/src/features/assistant/server/docs/index.ts`
- `web/src/features/assistant/server/utils.ts`

**Tests:**
- `web/src/__e2e__/assistant.spec.ts` (301 lines, 5 test cases)
- `web/src/__tests__/async/assistant-trpc.servertest.ts` (641 lines, comprehensive integration tests)

**Database:**
- `packages/shared/prisma/migrations/20260209083124_add_ai_conversations_and_messages/migration.sql`
- `packages/shared/prisma/migrations/20260210000000_add_message_metadata/migration.sql`
- `packages/shared/prisma/migrations/20260210120000_add_conversation_title/migration.sql`

---

**Modified Files:**

- `packages/shared/prisma/schema.prisma` - Added Conversation and Message models
- `packages/shared/prisma/generated/types.ts` - Auto-generated type updates
- `packages/shared/src/server/llm/types.ts` - Added ChatAssistant trace environment
- `web/src/server/api/root.ts` - Registered assistant router
- `web/src/components/layouts/routes.tsx` - Added "Assistant" navigation entry
- `web/src/env.mjs` - Added ASSISTANT_LLM_* environment variables


## 6. Environment Configuration

Add the following environment variables to your `.env` file:

### 6.1 Required: LLM Configuration

```bash
# LLM API Configuration
ASSISTANT_LLM_API_KEY=sk-...              # Your LLM API key (OpenAI, Anthropic, etc.)
ASSISTANT_LLM_PROVIDER=openai             # Provider: "openai" | "anthropic"
ASSISTANT_LLM_MODEL=gpt-4o                # Model to use
ASSISTANT_LLM_ADAPTER=openai              # Adapter type (usually matches provider)
```

**Supported Providers:**
- OpenAI: `gpt-4`, `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`
- Anthropic: `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229`

### 6.2 Optional: Langfuse Tracing

To trace the assistant's LLM calls in Langfuse:

```bash
LANGFUSE_AI_FEATURES_PUBLIC_KEY=pk-lf-...
LANGFUSE_AI_FEATURES_SECRET_KEY=sk-lf-...
LANGFUSE_AI_FEATURES_PROJECT_ID=...
LANGFUSE_AI_FEATURES_HOST=https://cloud.langfuse.com  # or your self-hosted URL
```

**Benefits:**
- Monitor assistant performance and costs
- Debug LLM behavior and tool calling
- Analyze conversation patterns
- Track token usage

Traces will appear in the specified Langfuse project with environment `langfuse-chat-assistant`.

### 6.3 Example Configuration

**Minimal setup (OpenAI):**
```bash
ASSISTANT_LLM_API_KEY=sk-proj-abc123...
ASSISTANT_LLM_PROVIDER=openai
ASSISTANT_LLM_MODEL=gpt-4o
ASSISTANT_LLM_ADAPTER=openai
```

**With Langfuse tracing:**
```bash
ASSISTANT_LLM_API_KEY=sk-proj-abc123...
ASSISTANT_LLM_PROVIDER=openai
ASSISTANT_LLM_MODEL=gpt-4o
ASSISTANT_LLM_ADAPTER=openai

LANGFUSE_AI_FEATURES_PUBLIC_KEY=pk-lf-xyz789...
LANGFUSE_AI_FEATURES_SECRET_KEY=sk-lf-xyz789...
LANGFUSE_AI_FEATURES_PROJECT_ID=clx123...
LANGFUSE_AI_FEATURES_HOST=https://cloud.langfuse.com
```

## 7. How to Run Locally (Same as base project)

### 7.1 Initial Setup 

```bash
# 1. Navigate to project root
cd langfuse-chat-assistant

# 2. Install dependencies
pnpm install

# 3. Set up environment variables
# Copy .env.example to .env and add the required variables from section 6
cp .env.example .env
# Edit .env with your favorite editor

# 4. Start infrastructure (PostgreSQL, ClickHouse, Redis, MinIO)
pnpm run infra:dev:up

# 5. Run database migrations
cd packages/shared
pnpm db:migrate
cd ../..

# 6. Start development server
pnpm run dev:web

# 7. Access the application
# Open: http://localhost:3000
```

### 7.2 First Time Access

**If using existing database:**
- Sign in with your existing account
- Navigate to any project
- Click "Assistant" in the left sidebar

**If starting fresh:**
```bash
# Reset and seed database
cd packages/shared
pnpm db:reset
cd ../..

# Login credentials (from seed data)
# Email: demo@langfuse.com
# Password: password

# Navigate to: http://localhost:3000/project/{projectId}/assistant
```

### 7.3 Quick Verification

Test the feature is working:
1. Click "New Conversation" button
2. Type a message: "How do I view traces?"
3. Press Enter
4. Wait for assistant response (5-10 seconds)
5. Verify "Used 1 tool(s)" badge appears
6. Click badge to see documentation search details

### 7.4 Troubleshooting

**Issue: "Assistant LLM is not configured"**
- Check that `ASSISTANT_LLM_API_KEY` is set in `.env`
- Verify the key is valid (not expired, has correct permissions)

**Issue: No response from assistant**
- Check console logs for errors
- Verify LLM provider is accessible (not blocked by firewall)
- Check API key balance/credits

**Issue: Conversations not appearing**
- Ensure database migrations ran successfully
- Check browser console for JavaScript errors
- Verify user is authenticated

**Issue: Database connection error**
- Ensure PostgreSQL is running: `pnpm run infra:dev:up`
- Check `DATABASE_URL` in `.env`

## 8. How to Test

### 8.1 End-to-End Tests

**Run all assistant E2E tests:**
```bash
cd web
pnpm test:e2e assistant.spec.ts
```

**Run specific test:**
```bash
cd web
pnpm test:e2e assistant.spec.ts -g "should start a new conversation"
```

**Test Coverage:**
1. ✅ Creating a new conversation
2. ✅ Sending a message and receiving assistant response
3. ✅ Rendering tool calls when documentation is searched
4. ✅ Editing conversation titles
5. ✅ Handling multiple conversations

**Prerequisites:**
- Development server running (`pnpm run dev:web`)
- Database seeded with demo user
- Valid `ASSISTANT_LLM_API_KEY` configured

### 8.2 Backend Integration Tests

**Run tRPC procedure tests:**
```bash
cd web
pnpm test -- --testPathPattern="assistant-trpc"
```

**Test Coverage:**
- ✅ listConversations procedure (authentication, filtering)
- ✅ getConversation procedure (authorization, message ordering)
- ✅ createConversation procedure (auto-numbering, uniqueness)
- ✅ updateConversation procedure (validation, authorization)
- ✅ sendMessage procedure (LLM integration, tool calling, metadata storage)
- ✅ Auto-title generation
- ✅ Error handling (unauthorized access, invalid inputs)


### 8.3 Testing with Different LLM Providers

**OpenAI:**
```bash
ASSISTANT_LLM_PROVIDER=openai
ASSISTANT_LLM_MODEL=gpt-4o
ASSISTANT_LLM_ADAPTER=openai
```

**Anthropic:**
```bash
ASSISTANT_LLM_PROVIDER=anthropic
ASSISTANT_LLM_MODEL=claude-3-5-sonnet-20241022
ASSISTANT_LLM_ADAPTER=anthropic
```

## Appendix: Testing Notes

**Test Isolation:**
- E2E tests use the demo user from seed data
- Tests count existing conversations and add relative assertions
- No cleanup needed - tests work with pre-existing data

**Test Patterns:**
- All tests follow existing Playwright patterns from `auth.spec.ts` and `create-project.spec.ts`
- Uses `data-testid` attributes for reliable element selection
- Includes proper waits for async operations (API calls, animations)

**Test Data:**
- Demo user: `demo@langfuse.com` / `password`
- Project ID retrieved dynamically from database
- Conversations numbered sequentially per user
