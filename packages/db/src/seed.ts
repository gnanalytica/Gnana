import { createDatabase } from "./index.js";
import { plans } from "./schema.js";

const db = createDatabase(process.env.DATABASE_URL!);

async function seed() {
  console.log("Seeding plans...");

  await db
    .insert(plans)
    .values([
      {
        name: "free",
        displayName: "Free",
        maxAgents: 3,
        maxRunsMonth: 100,
        maxMembers: 1,
        maxConnectors: 3,
        features: {},
        priceMonthly: 0,
        priceYearly: 0,
      },
      {
        name: "pro",
        displayName: "Pro",
        maxAgents: 25,
        maxRunsMonth: 5000,
        maxMembers: 10,
        maxConnectors: 25,
        features: { prioritySupport: true },
        priceMonthly: 2900,
        priceYearly: 29000,
      },
      {
        name: "enterprise",
        displayName: "Enterprise",
        maxAgents: -1,
        maxRunsMonth: -1,
        maxMembers: -1,
        maxConnectors: -1,
        features: { sso: true, auditLog: true, prioritySupport: true },
        priceMonthly: 0,
        priceYearly: 0,
      },
    ])
    .onConflictDoNothing();

  console.log("Plans seeded!");
  process.exit(0);
}

seed().catch(console.error);
