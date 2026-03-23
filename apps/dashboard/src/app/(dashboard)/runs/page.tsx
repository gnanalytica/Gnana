"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RunFiltersBar, type RunFilters } from "@/components/runs/run-filters";
import { RunList } from "@/components/runs/run-list";
import { useRuns } from "@/lib/hooks/use-runs";

const defaultFilters: RunFilters = {
  status: "all",
  agent: "all",
  triggerType: "all",
};

export default function RunsPage() {
  const [filters, setFilters] = useState<RunFilters>(defaultFilters);
  const { runs, isLoading, error } = useRuns();

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Runs</h1>
        <p className="text-muted-foreground mt-1">
          Monitor and manage agent pipeline runs.
        </p>
      </div>

      {error ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">
                Cannot connect to server
              </p>
              <p className="text-sm text-muted-foreground">
                Make sure the Gnana server is running at{" "}
                {process.env.NEXT_PUBLIC_GNANA_API_URL ?? "http://localhost:4000"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <RunFiltersBar onFilterChange={setFilters} />
          <RunList filters={filters} runs={runs} isLoading={isLoading} />
        </>
      )}
    </div>
  );
}
