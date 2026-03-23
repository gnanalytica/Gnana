"use client";

import { useState } from "react";
import { RunFiltersBar, type RunFilters } from "@/components/runs/run-filters";
import { RunList } from "@/components/runs/run-list";

const defaultFilters: RunFilters = {
  status: "all",
  agent: "all",
  triggerType: "all",
};

export default function RunsPage() {
  const [filters, setFilters] = useState<RunFilters>(defaultFilters);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Runs</h1>
        <p className="text-muted-foreground mt-1">
          Monitor and manage agent pipeline runs.
        </p>
      </div>

      <RunFiltersBar onFilterChange={setFilters} />

      <RunList filters={filters} />
    </div>
  );
}
