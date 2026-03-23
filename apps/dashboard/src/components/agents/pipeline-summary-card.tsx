"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import type { PipelineSpec } from "@/types/pipeline";

interface PipelineSummaryCardProps {
  spec: PipelineSpec;
  onOpenCanvas: () => void;
}

export function PipelineSummaryCard({ spec, onOpenCanvas }: PipelineSummaryCardProps) {
  const nodeTypeCounts = spec.nodes.reduce(
    (acc, n) => {
      acc[n.type] = (acc[n.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <Card className="border-primary/50 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Here&apos;s what I built</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <span className="text-sm font-medium">{spec.name}</span>
          <p className="text-xs text-muted-foreground mt-0.5">{spec.description}</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {Object.entries(nodeTypeCounts).map(([type, count]) => (
            <Badge key={type} variant="secondary" className="text-xs">
              {count} {type}
            </Badge>
          ))}
        </div>

        <div className="text-xs text-muted-foreground">
          {spec.nodes.length} nodes &middot; {spec.edges.length} connections
        </div>

        <Button onClick={onOpenCanvas} className="w-full gap-2">
          Open in Canvas
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
