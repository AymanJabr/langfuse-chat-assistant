# Langfuse User Guide

## Overview

Langfuse is an open-source LLM engineering platform for tracing, evaluating, and managing LLM applications. This guide covers all main features and how to use them.

---

## 1. Getting Started

### Creating an Organization
- Organizations are the top-level entity in Langfuse
- Navigate to the Organizations page to view or create organizations
- Each organization can have multiple projects

### Creating a Project
- Projects contain all your traces, prompts, datasets, and evaluations
- Go to Organization settings → Create new project
- Each project has its own API keys for integration

### Getting API Keys
1. Go to Project Settings → API Keys
2. Click "Create new API key"
3. Copy the Public Key and Secret Key
4. Use these keys in your application via the Langfuse SDK (Python or JavaScript/TypeScript)

---

## 2. Tracing & Observability

### What is Tracing?
Tracing captures the execution flow of your LLM application, including:
- All LLM calls (generations)
- Retrieval operations
- Tool/function calls
- User interactions
- Latency and costs

### Viewing Traces
1. Navigate to **Tracing** in the sidebar
2. Browse all traces in your project
3. Click on any trace to see its detailed execution tree
4. Filter traces by:
   - Time range
   - User ID
   - Tags
   - Metadata
   - Scores
   - Cost and latency

### Understanding Trace Structure
- **Trace**: Top-level container for a user interaction or workflow
- **Spans**: Intermediate steps (like retrieval, preprocessing)
- **Generations**: LLM API calls with input/output
- **Events**: Custom log points in your code

### How to Create Traces
**Using Python SDK:**
```python
from langfuse import Langfuse

langfuse = Langfuse()

# Create a trace
trace = langfuse.trace(
    name="user-query",
    user_id="user-123",
    metadata={"environment": "production"}
)

# Add a generation
generation = trace.generation(
    name="gpt-4-call",
    model="gpt-4",
    input="What is the weather?",
    output="I don't have access to real-time weather data."
)
```

**Using TypeScript SDK:**
```typescript
import { Langfuse } from "langfuse";

const langfuse = new Langfuse();

const trace = langfuse.trace({
  name: "user-query",
  userId: "user-123"
});

trace.generation({
  name: "gpt-4-call",
  model: "gpt-4",
  input: "What is the weather?",
  output: "I don't have access to real-time weather data."
});
```

### Searching Traces
- Use the search bar to filter by trace name, user ID, or metadata
- Apply multiple filters simultaneously
- Save common filter combinations for quick access
- Use Command+K (Mac) or Ctrl+K (Windows) to open quick search

---

## 3. Sessions

### What are Sessions?
Sessions group related traces together, representing a conversation or workflow with multiple user interactions.

### Viewing Sessions
1. Navigate to **Sessions** in the sidebar
2. See all sessions with aggregated metrics:
   - Total traces per session
   - Total cost and token usage
   - Session duration
3. Click on a session to see all traces within it

### Creating Sessions
**Using SDKs:**
```python
# All traces with the same session_id are grouped
trace = langfuse.trace(
    name="message-1",
    session_id="chat-session-abc123",
    user_id="user-123"
)
```

### Use Cases for Sessions
- Multi-turn conversations
- Document processing workflows
- Agent loops with multiple steps
- Any sequence of related LLM calls

---

## 4. Users

### Tracking Users
1. Navigate to **Users** in the sidebar
2. View all users who have interacted with your application
3. See per-user metrics:
   - Total traces
   - Total cost
   - Average latency
   - Score distributions

### How to Track Users
Simply include `user_id` when creating traces:
```python
trace = langfuse.trace(
    name="query",
    user_id="user-123"  # User identifier from your system
)
```

### Filtering by User
- Click on any user to see all their traces
- Filter traces by specific users in the Tracing view
- Export user-specific data for analysis

---

## 5. Dashboards

### Using Dashboards
1. Navigate to **Dashboards** in the sidebar
2. View pre-built dashboards showing:
   - Model usage over time
   - Cost breakdown by model
   - Latency percentiles (p50, p95, p99)
   - Score distributions
   - Error rates

### Creating Custom Dashboards
1. Click "Create Dashboard" in the Dashboards page
2. Add widgets:
   - Time series charts (usage, cost, latency)
   - Tables (top users, top traces)
   - Score distributions
3. Apply filters to focus on specific:
   - Time ranges
   - Models
   - Users
   - Tags

### Dashboard Widgets
- **Model Usage Chart**: Track which models are being used
- **Cost Chart**: Monitor spending over time
- **Latency Chart**: See performance trends
- **Scores Chart**: Track quality metrics
- **Model Cost Table**: Compare costs across models

---

## 6. Prompt Management

### What is Prompt Management?
Prompt management allows you to:
- Version control your prompts
- Deploy prompts without code changes
- A/B test different prompt versions
- Rollback to previous versions

### Creating a Prompt
1. Navigate to **Prompts** in the sidebar
2. Click "Create new prompt"
3. Fill in:
   - **Name**: Identifier for this prompt (e.g., "customer-support-greeting")
   - **Prompt text**: The actual prompt template
   - **Variables**: Placeholders like `{{user_name}}` or `{{context}}`
   - **Model settings**: Default model, temperature, max tokens
4. Click "Create"

### Prompt Formats
**Text Completion:**
```
You are a helpful assistant. Answer the user's question.

Question: {{question}}
Answer:
```

**Chat Messages:**
```json
[
  {
    "role": "system",
    "content": "You are a helpful assistant."
  },
  {
    "role": "user",
    "content": "{{user_message}}"
  }
]
```

### Versioning Prompts
1. Open an existing prompt
2. Click "Create new version"
3. Make your changes
4. Click "Save as new version"
5. Optionally set as "Production" version

### Using Prompts in Code
**Python:**
```python
from langfuse import Langfuse

langfuse = Langfuse()

# Fetch the prompt
prompt = langfuse.get_prompt("customer-support-greeting")

# Compile with variables
compiled = prompt.compile(user_name="John", context="Order status")

# Use with your LLM
response = openai.chat.completions.create(
    model="gpt-4",
    messages=compiled
)
```

**TypeScript:**
```typescript
const prompt = await langfuse.getPrompt("customer-support-greeting");
const compiled = prompt.compile({
  user_name: "John",
  context: "Order status"
});
```

### Prompt Linking with Traces
Link traces to prompts for automatic tracking:
```python
trace.generation(
    name="chat-completion",
    model="gpt-4",
    prompt=prompt,  # Link to prompt object
    input=compiled
)
```

---

## 7. Playground

### What is the Playground?
The Playground is an interactive environment to:
- Test prompts with different models
- Compare outputs across models
- Experiment with parameters (temperature, max tokens, etc.)
- Save successful prompts to Prompt Management

### Using the Playground
1. Navigate to **Playground** in the sidebar
2. Select a model provider (OpenAI, Anthropic, Google, etc.)
3. Choose a model (gpt-4, claude-3-opus, etc.)
4. Enter your prompt or load an existing prompt
5. Adjust parameters:
   - Temperature (0.0 - 2.0)
   - Max tokens
   - Top P
   - Frequency/presence penalty
6. Click "Run" to generate output

### Comparing Models
1. Click "Add model" to compare side-by-side
2. Run the same prompt across multiple models
3. Compare:
   - Output quality
   - Latency
   - Cost per request
   - Token usage

### Saving Prompts from Playground
1. After getting a good result, click "Save as Prompt"
2. Give it a name and save to Prompt Management
3. Use this prompt in your production code via SDK

### Testing with Variables
1. Define variables in your prompt: `{{variable_name}}`
2. Fill in variable values in the sidebar
3. Test different variable combinations quickly

---

## 8. Scores & Evaluation

### What are Scores?
Scores are metrics attached to traces or observations to measure quality, such as:
- User feedback (thumbs up/down)
- Correctness (0-1 or 0-100)
- Relevance ratings
- Custom metrics (toxicity, helpfulness, etc.)

### Viewing Scores
1. Navigate to **Scores** in the sidebar
2. See all scores across your project
3. Filter by:
   - Score name
   - Value range
   - Time period
   - Associated trace

### Creating Scores Manually
1. Open a trace
2. Click "Add Score"
3. Choose score name (or create new)
4. Enter value and optional comment
5. Click "Save"

### Creating Scores via SDK
**Python:**
```python
# Score a trace
langfuse.score(
    trace_id="trace-123",
    name="user-feedback",
    value=1,  # 1 for positive, 0 for negative
    comment="User was satisfied"
)

# Score a specific generation
langfuse.score(
    trace_id="trace-123",
    observation_id="gen-456",
    name="correctness",
    value=0.85  # 0-1 scale
)
```

### Score Types
- **Numeric**: Continuous values (0-1, 0-100, etc.)
- **Categorical**: Discrete values (positive/negative, A/B/C, etc.)
- **Boolean**: True/false, 1/0

### Using Scores
- Filter traces by score values
- Track score trends over time in Dashboards
- Use scores for dataset curation
- Trigger evaluations based on low scores

---

## 9. LLM-as-a-Judge (Automated Evaluation)

### What is LLM-as-a-Judge?
Automated evaluation using LLMs to score your traces based on criteria like:
- Correctness
- Relevance
- Coherence
- Helpfulness
- Safety/toxicity

### Creating an Eval Template
1. Navigate to **LLM-as-a-Judge** in the sidebar
2. Click "Create new template"
3. Define:
   - **Name**: e.g., "correctness-check"
   - **Prompt**: Evaluation instructions for the judge LLM
   - **Output format**: Score range (0-1, 0-100, etc.)
   - **Model**: Which model to use as judge (gpt-4, claude-3-opus, etc.)
4. Save template

### Example Eval Prompt
```
Evaluate the correctness of the assistant's response.

Question: {{input}}
Expected Answer: {{expected_output}}
Actual Answer: {{output}}

Rate the correctness on a scale of 0-100, where:
- 0 = Completely incorrect
- 50 = Partially correct
- 100 = Fully correct

Score:
```

### Running Evaluations
**Manual:**
1. Select traces to evaluate
2. Choose an eval template
3. Click "Run evaluation"
4. Scores are automatically added to traces

**Automated (via API):**
```python
# Eval runs automatically on all new traces matching filters
```

### Viewing Eval Results
1. Go to **LLM-as-a-Judge** → "Eval Runs"
2. See all evaluation jobs and their status
3. Click on a run to see individual scores
4. Filter traces by eval scores

### Use Cases
- Quality monitoring in production
- Regression testing for prompt changes
- A/B testing different models
- Automated content moderation

---

## 10. Human Annotation (Annotation Queues)

### What are Annotation Queues?
Annotation Queues help teams review and annotate traces manually, useful for:
- Quality assurance
- Creating ground truth datasets
- Reviewing edge cases
- Gathering human feedback

### Creating an Annotation Queue
1. Navigate to **Human Annotation** in the sidebar
2. Click "Create new queue"
3. Configure:
   - **Name**: e.g., "customer-support-review"
   - **Description**: What annotators should focus on
   - **Filters**: Which traces to include (by tags, users, scores, etc.)
   - **Assignees**: Team members who can annotate
4. Click "Create"

### Adding Items to Queue
**Automatic:**
- Items matching filters are automatically added

**Manual:**
1. Go to a trace
2. Click "Add to annotation queue"
3. Select which queue

### Annotating Items
1. Open an annotation queue
2. Click on an item to review
3. Review the trace (input, output, metadata)
4. Add:
   - Scores
   - Comments
   - Tags
5. Mark as "Complete" or "Skip"

### Queue Management
- View queue status (total items, completed, pending)
- Assign items to specific team members
- Export annotations for analysis
- Track annotator agreement rates

### Use Cases
- Labeling data for fine-tuning
- Quality assurance reviews
- Identifying failure patterns
- Creating evaluation datasets

---

## 11. Datasets

### What are Datasets?
Datasets are collections of input/output pairs used for:
- Testing prompts
- Evaluating models
- Benchmarking performance
- Regression testing

### Creating a Dataset
1. Navigate to **Datasets** in the sidebar
2. Click "Create new dataset"
3. Enter:
   - **Name**: e.g., "customer-support-test-cases"
   - **Description**: Purpose of this dataset
4. Click "Create"

### Adding Items to Dataset
**From traces:**
1. Go to a trace
2. Click "Add to dataset"
3. Select dataset and map fields:
   - Input: What goes in (e.g., user question)
   - Expected output: What should come out
4. Click "Add"

**Manual entry:**
1. Open a dataset
2. Click "Add item"
3. Fill in:
   - Input (text, JSON, or chat messages)
   - Expected output
   - Metadata (optional)
4. Click "Save"

**Bulk import:**
1. Open a dataset
2. Click "Import CSV" or "Import JSON"
3. Upload file with columns: input, expected_output, metadata
4. Map columns and import

### Dataset Item Structure
```json
{
  "input": "What is the capital of France?",
  "expected_output": "Paris",
  "metadata": {
    "category": "geography",
    "difficulty": "easy"
  }
}
```

### Running Dataset Tests
1. Open a dataset
2. Click "Run experiment"
3. Select:
   - Prompt (from Prompt Management)
   - Model and parameters
4. Click "Run"
5. View results comparing expected vs actual outputs

### Evaluating Results
- See side-by-side comparison of expected vs actual
- Automatic scoring (exact match, semantic similarity)
- Manual review of differences
- Export results for analysis

### Use Cases
- Prompt optimization and testing
- Model comparison
- Regression testing before deployment
- Building evaluation benchmarks

---

## 12. Settings

### Project Settings
Navigate to **Settings** (gear icon) to configure:

**General:**
- Project name and description
- Delete project

**API Keys:**
- Create/revoke API keys
- View API key usage

**LLM API Keys:**
- Add API keys for models (OpenAI, Anthropic, etc.)
- Used for Playground and LLM-as-a-Judge

**Members:**
- Invite team members
- Set roles (Owner, Admin, Member, Viewer)
- Remove members

**Integrations:**
- Posthog (analytics)
- Slack (notifications)
- Webhooks

**Danger Zone:**
- Transfer project
- Delete project (irreversible)

### Organization Settings
Navigate to **Organization** → **Settings**:

**General:**
- Organization name
- Logo and branding

**Members:**
- Manage organization-level members
- Set default project access

**Billing** (Cloud only):
- View usage and costs
- Manage subscription
- Update payment method
- View invoices

**Single Sign-On (SSO):**
- Configure SAML/OIDC (Enterprise plan)

---

## 13. Common Workflows

### Workflow 1: Setting Up Production Monitoring
1. Integrate Langfuse SDK into your application
2. Add tracing to all LLM calls
3. Create a dashboard to monitor key metrics
4. Set up LLM-as-a-Judge for automated quality checks
5. Create annotation queue for manual review of edge cases

### Workflow 2: Prompt Engineering & Testing
1. Create prompts in Playground
2. Test with different models and parameters
3. Save successful prompts to Prompt Management
4. Create dataset with test cases
5. Run experiments to compare prompt versions
6. Deploy best-performing prompt via SDK

### Workflow 3: Quality Assurance
1. Filter traces by low scores or errors
2. Add problematic traces to annotation queue
3. Team reviews and annotates issues
4. Create dataset items from failures
5. Use dataset for regression testing
6. Iterate on prompts to fix issues

### Workflow 4: Cost Optimization
1. View cost dashboard to identify expensive operations
2. Filter traces by high cost
3. Analyze what causes high costs (long outputs, expensive models)
4. Test cheaper models in Playground
5. Run experiments on dataset to validate quality
6. Deploy optimized prompts/models

---

## 14. Filtering and Search

### Available Filters (across Traces, Sessions, Users)
- **Time range**: Last hour, day, week, month, custom
- **User ID**: Filter by specific users
- **Tags**: Custom tags added to traces
- **Metadata**: Filter by any metadata key/value
- **Scores**: Filter by score name and value range
- **Model**: Filter by LLM model used
- **Cost**: Filter by cost range
- **Latency**: Filter by duration range
- **Status**: Success, error
- **Name**: Filter by trace/span/generation name

### Saving Filters
1. Apply filters in any view
2. Click "Save filter"
3. Give it a name
4. Access saved filters from dropdown

### Quick Search (Command+K / Ctrl+K)
- Press Command+K (Mac) or Ctrl+K (Windows)
- Quickly navigate to:
  - Traces by ID
  - Users by ID
  - Prompts by name
  - Datasets by name
  - Settings pages

---

## 15. Integrations & SDKs

### Python SDK
```bash
pip install langfuse
```

**Basic usage:**
```python
from langfuse import Langfuse

langfuse = Langfuse(
    public_key="pk-...",
    secret_key="sk-...",
    host="https://cloud.langfuse.com"  # or your self-hosted URL
)
```

### JavaScript/TypeScript SDK
```bash
npm install langfuse
```

**Basic usage:**
```typescript
import { Langfuse } from "langfuse";

const langfuse = new Langfuse({
  publicKey: "pk-...",
  secretKey: "sk-...",
  baseUrl: "https://cloud.langfuse.com"
});
```

### Framework Integrations
- **LangChain**: Automatic tracing via callback handler
- **LlamaIndex**: Native integration
- **OpenAI SDK**: Wrapper for automatic tracing
- **Anthropic SDK**: Wrapper for automatic tracing

### API Access
- REST API available for all operations
- API documentation: https://api.reference.langfuse.com
- Use API keys from Project Settings

---

## 16. Tips & Best Practices

### Naming Conventions
- Use descriptive names for traces: `user-query`, `document-processing`
- Use consistent naming for generations: `gpt-4-call`, `embedding-generation`
- Use hierarchical names: `rag/retrieval`, `rag/generation`

### Metadata Best Practices
- Add environment tags: `{"environment": "production"}`
- Track versions: `{"app_version": "1.2.3"}`
- Add context: `{"user_tier": "premium"}`
- Keep metadata searchable and consistent

### Cost Tracking
- Always include model name in generations
- Track token usage for accurate cost calculation
- Set up cost alerts in Settings
- Regularly review cost dashboard

### Performance Optimization
- Use sampling for high-volume applications
- Async SDK methods for better performance
- Batch operations when possible
- Use sessions to reduce overhead

### Security
- Never commit API keys to code
- Use environment variables for keys
- Rotate keys regularly
- Restrict API key permissions by role

---

## 17. Troubleshooting

### Traces Not Appearing
- Check API keys are correct
- Verify SDK is calling `flush()` or `shutdown()` at app exit
- Check network connectivity to Langfuse host
- Review SDK logs for errors

### High Costs
- Check for duplicate traces
- Review token usage per trace
- Consider cheaper models for non-critical operations
- Use caching where appropriate

### Slow Performance
- Check if too many traces are being sent
- Use sampling for high-volume scenarios
- Verify network latency to Langfuse host
- Consider self-hosting for better performance

### SDK Issues
- Update to latest SDK version
- Check for known issues on GitHub
- Review SDK documentation
- Contact support

---

## 18. Getting Help

### Documentation
- Official docs: https://langfuse.com/docs
- API reference: https://api.reference.langfuse.com
- GitHub: https://github.com/langfuse/langfuse

### Support Channels
- Discord community: https://langfuse.com/discord
- GitHub issues for bugs/feature requests
- Email support for enterprise customers
- Book a call for onboarding (available in sidebar)

### Support Button
- Click "Support" in the bottom sidebar
- Access documentation, Discord, and GitHub
- Report issues or request features

---

## Summary

Langfuse provides comprehensive LLM observability and management through:
- **Tracing**: Capture all LLM calls and workflows
- **Prompts**: Version control and manage prompts
- **Evaluation**: Automated and manual quality checks
- **Datasets**: Test and benchmark performance
- **Analytics**: Dashboards for cost, latency, and quality

Start by integrating the SDK, then progressively adopt more features as your needs grow.
