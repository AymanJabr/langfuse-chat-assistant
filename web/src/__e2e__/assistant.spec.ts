import { type Page, test, expect } from "@playwright/test";
import { prisma } from "@langfuse/shared/src/db";

// Helper function to sign in a user (matches pattern from create-project.spec.ts)
async function signin(page: Page) {
  await page.goto("/auth/sign-in");
  await page.fill('input[name="email"]', "demo@langfuse.com");
  await page.fill('input[type="password"]', "password");

  await expect(
    page.locator('button[data-testid="submit-email-password-sign-in-form"]'),
  ).toBeEnabled();

  await page.click('button[data-testid="submit-email-password-sign-in-form"]');

  await page.waitForTimeout(2000);

  const errorElement = page.locator(".text-destructive");
  const hasError = await errorElement.isVisible().catch(() => false);
  if (hasError) {
    const errorText = await errorElement.textContent();
    throw new Error(`Sign-in failed with error: ${errorText}`);
  }

  await expect(page).toHaveURL("/");
}

// Helper function to get a project URL for a user's email (matches pattern from create-project.spec.ts)
async function getProjectUrlForEmail(email: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      organizationMemberships: {
        include: {
          organization: {
            include: {
              projects: true,
            },
          },
        },
      },
    },
  });

  if (!user) throw new Error(`User not found: ${email}`);

  const project = user.organizationMemberships[0]?.organization.projects[0];
  if (!project) throw new Error(`No project found for user: ${email}`);

  return `/project/${project.id}`;
}

test.describe("Assistant Feature", () => {
  test.beforeEach(async ({ page }) => {
    // Sign in with demo user (from seed data)
    await signin(page);
  });

  test("should start a new conversation", async ({ page }) => {
    // Get project URL and navigate to assistant
    const projectUrl = await getProjectUrlForEmail("demo@langfuse.com");
    await page.goto(`${projectUrl}/assistant`);

    // Verify page loaded
    await expect(page.getByTestId("page-header-title")).toContainText(
      "Assistant",
    );

    // Verify empty state shows when no conversation is selected
    await expect(page.getByTestId("empty-state-no-conversation")).toBeVisible();
    await expect(page.getByText("No conversation selected")).toBeVisible();

    // Wait for page to fully load
    await page
      .getByTestId("new-conversation-button")
      .waitFor({ state: "visible" });
    await page.waitForTimeout(1000);

    // Count conversations before creating new one
    const conversationsBeforeCount = await page
      .locator('[data-testid^="conversation-item-"]')
      .count();

    // Click New Conversation button
    await page.getByTestId("new-conversation-button").click();

    // Wait for conversation to be created and selected
    await page.waitForTimeout(1000);

    // Verify a new conversation was added
    const conversationsAfterCount = await page
      .locator('[data-testid^="conversation-item-"]')
      .count();
    expect(conversationsAfterCount).toBe(conversationsBeforeCount + 1);

    // Verify conversation appears in sidebar with numbered title pattern
    const firstConversation = page
      .locator('[data-testid^="conversation-item-"]')
      .first();
    await expect(firstConversation).toBeVisible();

    // Check that title follows "Conversation #N" pattern (don't care about exact number)
    const conversationTitle = await firstConversation
      .getByTestId("conversation-title")
      .textContent();
    expect(conversationTitle).toMatch(/^Conversation #\d+$/);

    // Verify conversation is selected (has border-primary class)
    await expect(firstConversation).toHaveClass(/border-primary/);

    // Verify empty messages state shows
    await expect(page.getByText("No messages yet")).toBeVisible();
    await expect(
      page.getByText("Start the conversation by typing below"),
    ).toBeVisible();
  });

  test("should send a message and receive a response", async ({ page }) => {
    // Get project URL and navigate to assistant
    const projectUrl = await getProjectUrlForEmail("demo@langfuse.com");
    await page.goto(`${projectUrl}/assistant`);

    // Create a new conversation
    await page.getByTestId("new-conversation-button").click();
    await page.waitForTimeout(1000);

    // Type a message in the chat input
    const testMessage = "Hello, how can you help me?";
    await page.getByTestId("chat-input-textarea").fill(testMessage);

    // Send the message by pressing Enter
    await page.getByTestId("chat-input-textarea").press("Enter");

    // Verify user message appears immediately (optimistic update)
    const userMessage = page.getByTestId("chat-message-user");
    await expect(userMessage).toBeVisible();
    await expect(userMessage).toContainText(testMessage);

    // Wait for assistant response (can take several seconds)
    const assistantMessage = page.getByTestId("chat-message-assistant");
    await expect(assistantMessage).toBeVisible({ timeout: 15000 });

    // Verify assistant response has content
    await expect(assistantMessage.locator("p")).not.toBeEmpty();

    // Verify message counter updates in sidebar
    const conversation = page
      .locator('[data-testid^="conversation-item-"]')
      .first();
    await expect(conversation).toContainText("2 messages"); // 1 user + 1 assistant

    // Verify conversation title was auto-generated from first message
    await expect(
      conversation.getByTestId("conversation-title"),
    ).not.toContainText("Conversation #1");
  });

  test("should render tool calls when assistant uses documentation search", async ({
    page,
  }) => {
    // Get project URL and navigate to assistant
    const projectUrl = await getProjectUrlForEmail("demo@langfuse.com");
    await page.goto(`${projectUrl}/assistant`);

    // Create a new conversation
    await page.getByTestId("new-conversation-button").click();
    await page.waitForTimeout(1000);

    // Send a message that should trigger documentation search
    const testMessage = "How do I view traces?";
    await page.getByTestId("chat-input-textarea").fill(testMessage);
    await page.getByTestId("chat-send-button").click();

    // Wait for assistant response
    const assistantMessage = page.getByTestId("chat-message-assistant");
    await expect(assistantMessage).toBeVisible({ timeout: 15000 });

    // Verify tool calls badge appears
    const toolCallsBadge = page.getByTestId("tool-calls-badge");
    await expect(toolCallsBadge).toBeVisible();
    await expect(toolCallsBadge).toContainText("Used");
    await expect(toolCallsBadge).toContainText("tool(s)");

    // Click badge to expand tool details
    await toolCallsBadge.click();

    // Verify tool call item appears
    const toolCallItem = page.getByTestId("tool-call-item");
    await expect(toolCallItem).toBeVisible();

    // Verify tool name is displayed
    await expect(toolCallItem).toContainText("search_documentation");

    // Verify query parameter is shown
    await expect(toolCallItem).toContainText("Query:");
  });

  test("should allow editing conversation title", async ({ page }) => {
    // Get project URL and navigate to assistant
    const projectUrl = await getProjectUrlForEmail("demo@langfuse.com");
    await page.goto(`${projectUrl}/assistant`);

    // Create a new conversation
    await page.getByTestId("new-conversation-button").click();
    await page.waitForTimeout(1000);

    // Hover over conversation to reveal edit button
    const conversation = page
      .locator('[data-testid^="conversation-item-"]')
      .first();
    await conversation.hover();

    // Click edit button (pencil icon)
    await conversation
      .locator("button")
      .filter({ hasText: "" })
      .first()
      .click();

    // Wait for input to appear
    const titleInput = conversation.locator("input");
    await expect(titleInput).toBeVisible();

    // Change the title
    const newTitle = "My Custom Conversation Title";
    await titleInput.fill(newTitle);

    // Save by clicking check button or pressing Enter
    await titleInput.press("Enter");

    // Wait for update to complete
    await page.waitForTimeout(500);

    // Verify title was updated
    await expect(conversation.getByTestId("conversation-title")).toContainText(
      newTitle,
    );
  });

  test("should handle multiple conversations", async ({ page }) => {
    // Get project URL and navigate to assistant
    const projectUrl = await getProjectUrlForEmail("demo@langfuse.com");
    await page.goto(`${projectUrl}/assistant`);

    // Wait for page to fully load by waiting for the New Conversation button
    await page
      .getByTestId("new-conversation-button")
      .waitFor({ state: "visible" });

    // Give the conversation list time to load from API
    await page.waitForTimeout(1000);

    // Count existing conversations after the page has loaded
    const initialCount = await page
      .locator('[data-testid^="conversation-item-"]')
      .count();

    // Create first conversation
    await page.getByTestId("new-conversation-button").click();
    await page.waitForTimeout(1000);

    // Get the first conversation we just created (most recent, at top)
    const firstConversation = page
      .locator('[data-testid^="conversation-item-"]')
      .first();

    // Verify it has numbered title pattern
    const firstTitle = await firstConversation
      .getByTestId("conversation-title")
      .textContent();
    expect(firstTitle).toMatch(/^Conversation #\d+$/);

    // Extract the number for comparison
    const firstNumber = parseInt(firstTitle?.match(/#(\d+)/)?.[1] || "0");

    // Create second conversation
    await page.getByTestId("new-conversation-button").click();
    await page.waitForTimeout(1000);

    // Verify we now have two more conversations than we started with
    const conversations = page.locator('[data-testid^="conversation-item-"]');
    await expect(conversations).toHaveCount(initialCount + 2);

    // Get the second conversation we created (now at top, most recent)
    const secondConversation = conversations.nth(0);

    // Verify second conversation number is one more than first
    const secondTitle = await secondConversation
      .getByTestId("conversation-title")
      .textContent();
    const secondNumber = parseInt(secondTitle?.match(/#(\d+)/)?.[1] || "0");
    expect(secondNumber).toBe(firstNumber + 1);

    // Click on first conversation to select it (now at index 1, not 0)
    await conversations.nth(1).click();
    await page.waitForTimeout(500);

    // Verify first conversation is now selected (has border-primary)
    await expect(conversations.nth(1)).toHaveClass(/border-primary/);
  });
});
