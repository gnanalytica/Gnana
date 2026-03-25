"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, ArrowUpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useWorkspaces } from "@/lib/hooks/use-workspaces";

interface UsageMetric {
  used: number;
  limit: number;
}

interface WorkspaceUsage {
  plan: string;
  agents: UsageMetric;
  connectors: UsageMetric;
  members: UsageMetric;
  runs: UsageMetric;
  tokensThisMonth: number;
}

interface PlanFeature {
  text: string;
  included: boolean;
}

interface Plan {
  name: string;
  price: string;
  period: string;
  description: string;
  features: PlanFeature[];
  cta: string;
}

const plans: Plan[] = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "For individuals and small experiments.",
    cta: "Current Plan",
    features: [
      { text: "3 agents", included: true },
      { text: "100 runs / month", included: true },
      { text: "1 team member", included: true },
      { text: "Community support", included: true },
      { text: "Custom connectors", included: false },
      { text: "Priority support", included: false },
    ],
  },
  {
    name: "Pro",
    price: "$29",
    period: "per month",
    description: "For teams building production agents.",
    cta: "Upgrade to Pro",
    features: [
      { text: "Unlimited agents", included: true },
      { text: "10,000 runs / month", included: true },
      { text: "10 team members", included: true },
      { text: "Priority support", included: true },
      { text: "Custom connectors", included: true },
      { text: "Dedicated infrastructure", included: false },
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "contact us",
    description: "For organizations with advanced needs.",
    cta: "Contact Sales",
    features: [
      { text: "Unlimited agents", included: true },
      { text: "Unlimited runs", included: true },
      { text: "Unlimited team members", included: true },
      { text: "Dedicated support", included: true },
      { text: "Custom connectors", included: true },
      { text: "Dedicated infrastructure", included: true },
    ],
  },
];

function formatLimit(limit: number): string {
  return limit === -1 ? "unlimited" : String(limit);
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const isUnlimited = limit === -1;
  const pct = isUnlimited ? Math.min((used / 100) * 100, 5) : Math.min((used / limit) * 100, 100);
  const barColor =
    !isUnlimited && pct >= 90
      ? "bg-destructive"
      : !isUnlimited && pct >= 70
        ? "bg-yellow-500"
        : "bg-primary";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {used} / {formatLimit(limit)}
            </span>
            {!isUnlimited && <span>{Math.round(pct)}%</span>}
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${barColor} transition-all`}
              style={{ width: isUnlimited ? "3%" : `${pct}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function UsageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-36" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-20" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="h-3 w-16 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-5 w-48 mt-4" />
    </div>
  );
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export default function BillingPage() {
  const { current } = useWorkspaces();
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgradeClicked, setUpgradeClicked] = useState(false);

  const fetchUsage = useCallback(async () => {
    if (!current?.id) return;
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.fetch(`/api/workspaces/${current.id}/usage`);
      const data = (await res.json()) as WorkspaceUsage;
      setUsage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage data");
    } finally {
      setIsLoading(false);
    }
  }, [current?.id]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const currentPlan = usage?.plan?.toLowerCase() ?? "free";

  return (
    <div className="p-8 max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Billing & Usage</h1>
        <p className="text-muted-foreground mt-1">
          Monitor resource usage and manage your subscription.
        </p>
      </div>

      <Separator />

      {/* Current Usage */}
      {isLoading ? (
        <UsageSkeleton />
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchUsage}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : usage ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Current Usage</h2>
            <Badge variant="secondary" className="capitalize">
              {usage.plan} Plan
            </Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <UsageBar label="Agents" used={usage.agents.used} limit={usage.agents.limit} />
            <UsageBar label="Connectors" used={usage.connectors.used} limit={usage.connectors.limit} />
            <UsageBar label="Team Members" used={usage.members.used} limit={usage.members.limit} />
            <UsageBar label="Runs this month" used={usage.runs.used} limit={usage.runs.limit} />
          </div>

          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Tokens this month</p>
                <p className="text-2xl font-bold">{formatTokenCount(usage.tokensThisMonth)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Upgrade button */}
          {currentPlan === "free" && (
            <Button
              onClick={() => setUpgradeClicked(true)}
              disabled={upgradeClicked}
              className="gap-2"
            >
              <ArrowUpCircle className="h-4 w-4" />
              {upgradeClicked ? "Coming soon!" : "Upgrade Plan"}
            </Button>
          )}
        </div>
      ) : null}

      <Separator />

      {/* Plans */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Plans</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = plan.name.toLowerCase() === currentPlan;
            return (
              <Card key={plan.name} className={isCurrent ? "border-primary shadow-sm" : ""}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                    {isCurrent && (
                      <Badge variant="secondary" className="border-0">
                        Current
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">{plan.price}</span>
                    <span className="text-sm text-muted-foreground ml-1">/ {plan.period}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2">
                    {plan.features.map((feature) => (
                      <li key={feature.text} className="flex items-center gap-2 text-sm">
                        <Check
                          className={`h-4 w-4 shrink-0 ${
                            feature.included ? "text-primary" : "text-muted-foreground/30"
                          }`}
                        />
                        <span className={feature.included ? "" : "text-muted-foreground/50"}>
                          {feature.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant={isCurrent ? "outline" : "default"}
                    className="w-full"
                    disabled={isCurrent}
                  >
                    {isCurrent ? "Current Plan" : plan.cta}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
