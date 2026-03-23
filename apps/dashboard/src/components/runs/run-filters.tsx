"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface RunFilters {
  status: string;
  agent: string;
  triggerType: string;
}

interface RunFiltersProps {
  onFilterChange: (filters: RunFilters) => void;
}

const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "analyzing", label: "Analyzing" },
  { value: "planning", label: "Planning" },
  { value: "awaiting_approval", label: "Awaiting Approval" },
  { value: "executing", label: "Executing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

const triggerOptions = [
  { value: "all", label: "All Triggers" },
  { value: "manual", label: "Manual" },
  { value: "webhook", label: "Webhook" },
  { value: "assignment", label: "Assignment" },
  { value: "mention", label: "Mention" },
];

const defaultFilters: RunFilters = {
  status: "all",
  agent: "all",
  triggerType: "all",
};

export function RunFiltersBar({ onFilterChange }: RunFiltersProps) {
  const [filters, setFilters] = useState<RunFilters>(defaultFilters);

  function updateFilter(key: keyof RunFilters, value: string) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    onFilterChange(next);
  }

  function clearFilters() {
    setFilters(defaultFilters);
    onFilterChange(defaultFilters);
  }

  const hasActiveFilters =
    filters.status !== "all" || filters.agent !== "all" || filters.triggerType !== "all";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={filters.status} onValueChange={(v) => updateFilter("status", v)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.agent} onValueChange={(v) => updateFilter("agent", v)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All Agents" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Agents</SelectItem>
          <SelectItem value="agent-1">Weekly Report Agent</SelectItem>
          <SelectItem value="agent-2">Slack Summarizer</SelectItem>
          <SelectItem value="agent-3">Code Review Agent</SelectItem>
          <SelectItem value="agent-4">Data Pipeline Monitor</SelectItem>
        </SelectContent>
      </Select>

      <Select value={filters.triggerType} onValueChange={(v) => updateFilter("triggerType", v)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All Triggers" />
        </SelectTrigger>
        <SelectContent>
          {triggerOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="h-4 w-4" />
          Clear Filters
        </Button>
      )}
    </div>
  );
}
