import { createDatabase } from "./index.js";
import { plans, workspaces } from "./schema.js";
import { eq, isNull } from "drizzle-orm";

const DEFAULT_PLANS = [
  {
    name: "free",
    displayName: "Free",
    maxAgents: 3,
    maxConnectors: 2,
    maxMembers: 1,
    maxRunsMonth: 100,
    priceMonthly: 0,
    priceYearly: 0,
    features: {
      communitySupport: true,
      customConnectors: false,
      prioritySupport: false,
      dedicatedInfra: false,
    },
  },
  {
    name: "pro",
    displayName: "Pro",
    maxAgents: -1,
    maxConnectors: 10,
    maxMembers: 10,
    maxRunsMonth: 1000,
    priceMonthly: 2900,
    priceYearly: 29000,
    features: {
      communitySupport: true,
      customConnectors: true,
      prioritySupport: true,
      dedicatedInfra: false,
    },
  },
  {
    name: "enterprise",
    displayName: "Enterprise",
    maxAgents: -1,
    maxConnectors: -1,
    maxMembers: -1,
    maxRunsMonth: -1,
    priceMonthly: 0,
    priceYearly: 0,
    features: {
      communitySupport: true,
      customConnectors: true,
      prioritySupport: true,
      dedicatedInfra: true,
    },
  },
];

export async function seed(connectionString: string) {
  const db = createDatabase(connectionString);

  // Upsert plans (idempotent by unique name)
  for (const plan of DEFAULT_PLANS) {
    const existing = await db.select().from(plans).where(eq(plans.name, plan.name)).limit(1);
    if (existing.length === 0) {
      await db.insert(plans).values(plan);
      console.log(`  Created plan: ${plan.displayName}`);
    } else {
      console.log(`  Plan already exists: ${plan.displayName}`);
    }
  }

  // Auto-assign Free plan to workspaces that have no plan
  const freePlan = await db.select().from(plans).where(eq(plans.name, "free")).limit(1);
  if (freePlan[0]) {
    const updated = await db
      .update(workspaces)
      .set({ planId: freePlan[0].id })
      .where(isNull(workspaces.planId))
      .returning({ id: workspaces.id });
    if (updated.length > 0) {
      console.log(`  Assigned Free plan to ${updated.length} workspace(s)`);
    }
  }

  console.log("Seed complete.");
}

// CLI entry point: pnpm --filter @gnana/db db:seed
const dbUrl = process.env.DATABASE_URL;
if (dbUrl) {
  seed(dbUrl).catch(console.error);
} else {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
