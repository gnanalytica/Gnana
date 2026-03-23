export interface AgentTemplate {
  name: string;
  description: string;
  systemPrompt: string;
  suggestedModel: { provider: string; model: string };
  suggestedTools: string[];
  approval: "required" | "auto";
}

export const templates: AgentTemplate[] = [
  {
    name: "PM Analyst",
    description: "Analyzes tickets, finds duplicates, and creates action plans",
    systemPrompt:
      "You are a project management analyst. Analyze tickets thoroughly, identify related issues, find duplicates, and create structured action plans. Be concise and data-driven.",
    suggestedModel: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    suggestedTools: ["search_tickets", "get_ticket_details", "find_similar"],
    approval: "required",
  },
  {
    name: "Code Reviewer",
    description: "Reviews pull requests and provides actionable feedback",
    systemPrompt:
      "You are a code reviewer. Review code changes for correctness, performance, security, and maintainability. Provide specific, actionable feedback with code examples when helpful.",
    suggestedModel: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    suggestedTools: ["get_pr_diff", "search_codebase", "get_file"],
    approval: "auto",
  },
  {
    name: "Report Generator",
    description: "Generates reports from data sources with analysis",
    systemPrompt:
      "You are a report generator. Collect data from provided sources, analyze trends, and generate clear, structured reports with actionable insights.",
    suggestedModel: { provider: "google", model: "gemini-2.5-flash" },
    suggestedTools: ["query_database", "get_metrics"],
    approval: "required",
  },
  {
    name: "Support Agent",
    description: "Handles customer support inquiries with knowledge base lookup",
    systemPrompt:
      "You are a customer support agent. Answer inquiries using the knowledge base, escalate complex issues, and maintain a helpful, professional tone.",
    suggestedModel: { provider: "openai", model: "gpt-4.1" },
    suggestedTools: ["search_knowledge_base", "get_customer_info"],
    approval: "auto",
  },
  {
    name: "Data Analyst",
    description: "Queries databases and generates insights from data",
    systemPrompt:
      "You are a data analyst. Write and execute SQL queries, analyze results, identify patterns, and present findings clearly with supporting data.",
    suggestedModel: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    suggestedTools: ["query", "list_tables", "describe_table"],
    approval: "required",
  },
];
