import fs from "fs";
import path from "path";

export type DocSearchResult = {
  section: string;
  content: string;
  relevance: number;
};

// Common stop words that don't add meaning to search
const STOP_WORDS = new Set([
  "how",
  "do",
  "does",
  "i",
  "can",
  "what",
  "is",
  "are",
  "the",
  "a",
  "an",
  "to",
  "in",
  "on",
  "for",
  "with",
  "from",
  "my",
  "me",
  "you",
  "should",
  "would",
  "could",
]);

/**
 * Search the Langfuse documentation for relevant information.
 * Uses simple keyword matching to find relevant sections.
 *
 * @param query - Search query (e.g., "how to create a prompt")
 * @param limit - Maximum number of results to return (default: 5)
 * @returns Array of relevant documentation sections
 */
export async function searchDocumentation(
  query: string,
  limit: number = 5,
): Promise<DocSearchResult[]> {
  try {
    // Read the documentation file
    // process.cwd() is already at monorepo root, so just add the path from there
    const docsPath = path.join(
      process.cwd(),
      "web/src/features/assistant/server/docs/langfuse-user-guide.md",
    );

    console.log("📖 Reading documentation from:", docsPath);
    console.log("📖 File exists:", fs.existsSync(docsPath));

    const docsContent = fs.readFileSync(docsPath, "utf-8");
    console.log("📖 Documentation loaded, length:", docsContent.length);

    // Split into sections by ## headers
    const sections = splitIntoSections(docsContent);

    // Calculate relevance for each section
    const results = sections
      .map((section) => ({
        section: section.title,
        content: section.content,
        relevance: calculateRelevance(query, section.content, section.title),
      }))
      .filter((result) => result.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);

    return results;
  } catch (error) {
    console.error("❌ Documentation search error:", error);
    console.error(
      "❌ Error details:",
      error instanceof Error ? error.message : String(error),
    );
    console.error("❌ Stack:", error instanceof Error ? error.stack : "");
    throw error;
  }
}

type Section = {
  title: string;
  content: string;
};

function splitIntoSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const lines = markdown.split("\n");
  let currentSection: Section | null = null;

  for (const line of lines) {
    // Check for ## headers (main sections)
    if (line.startsWith("## ")) {
      // Save previous section
      if (currentSection) {
        sections.push(currentSection);
      }
      // Start new section
      currentSection = {
        title: line.replace("## ", "").trim(),
        content: "",
      };
    } else if (currentSection) {
      // Add line to current section
      currentSection.content += line + "\n";
    }
  }

  // Add last section
  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

function calculateRelevance(
  query: string,
  content: string,
  title: string,
): number {
  const queryLower = query.toLowerCase();
  const contentLower = content.toLowerCase();
  const titleLower = title.toLowerCase();

  let score = 0;

  // Normalize common spelling variations
  const normalizedQuery = normalizeQuery(queryLower);

  // Split query into terms and filter out stop words
  const queryTerms = normalizedQuery
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .filter((term) => !STOP_WORDS.has(term));

  // If no meaningful terms after filtering, fall back to full query
  if (queryTerms.length === 0) {
    queryTerms.push(queryLower);
  }

  for (const term of queryTerms) {
    // Title matches are worth more (15x)
    const titleMatches =
      (titleLower.match(new RegExp(term, "g")) || []).length * 15;

    // Content matches
    const contentMatches = (contentLower.match(new RegExp(term, "g")) || [])
      .length;

    score += titleMatches + contentMatches;
  }

  // Boost for exact phrase match
  if (contentLower.includes(normalizedQuery)) {
    score += 50;
  }

  // Boost for title containing query
  if (titleLower.includes(normalizedQuery)) {
    score += 100;
  }

  // Boost for beginner-related queries matching getting started sections
  if (isBeginnerQuery(normalizedQuery) && isBeginnerSection(titleLower)) {
    score *= 1.5;
  }

  return score;
}

function normalizeQuery(query: string): string {
  return query
    .replace(/organisation/g, "organization")
    .replace(/visualise/g, "visualize")
    .replace(/initialise/g, "initialize")
    .replace(/analyse/g, "analyze");
}

function isBeginnerQuery(query: string): boolean {
  return /create|new|start|begin|setup|get started|make|add|first|initial/i.test(
    query,
  );
}

function isBeginnerSection(title: string): boolean {
  return /getting started|creating|setup|introduction|quick start|first|initial/i.test(
    title,
  );
}
