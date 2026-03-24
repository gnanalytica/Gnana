import { z } from "zod";

// ──────────────────────────────────────
// Agents
// ──────────────────────────────────────

export const createAgentSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().default(""),
  toolsConfig: z.record(z.string(), z.unknown()).optional(),
  llmConfig: z.record(z.string(), z.unknown()).default({}),
  triggersConfig: z.array(z.unknown()).optional(),
  approval: z.enum(["required", "auto", "none"]).optional(),
  maxToolRounds: z.number().int().min(1).max(100).optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().optional(),
  toolsConfig: z.record(z.string(), z.unknown()).optional(),
  llmConfig: z.record(z.string(), z.unknown()).optional(),
  triggersConfig: z.array(z.unknown()).optional(),
  approval: z.enum(["required", "auto", "none"]).optional(),
  maxToolRounds: z.number().int().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

// ──────────────────────────────────────
// Runs
// ──────────────────────────────────────

export const createRunSchema = z.object({
  agentId: z.string().uuid("agentId must be a valid UUID"),
  triggerType: z.enum(["manual", "api", "schedule"]).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

// ──────────────────────────────────────
// Connectors
// ──────────────────────────────────────

export const createConnectorSchema = z.object({
  type: z.string().min(1, "Type is required").max(100),
  name: z.string().min(1, "Name is required").max(255),
  authType: z.string().min(1, "Auth type is required").max(100),
  credentials: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// ──────────────────────────────────────
// Providers
// ──────────────────────────────────────

export const createProviderSchema = z.object({
  type: z.enum(["anthropic", "google", "openai"], {
    message: "Type must be one of: anthropic, google, openai",
  }),
  name: z.string().min(1, "Name is required").max(255),
  apiKey: z.string().min(1, "API key is required"),
  baseUrl: z.string().url().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  model: z.string().max(255).optional(),
});

// ──────────────────────────────────────
// Workspaces
// ──────────────────────────────────────

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens")
    .optional(),
});

const workspaceRoleEnum = z.enum(["owner", "admin", "editor", "viewer"]);

export const inviteMemberSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  role: workspaceRoleEnum.optional(),
});

export const updateMemberRoleSchema = z.object({
  role: workspaceRoleEnum,
});
