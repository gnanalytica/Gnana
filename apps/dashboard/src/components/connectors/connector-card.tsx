"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const typeIcons: Record<string, string> = {
  github: "\uD83D\uDC19",
  slack: "\uD83D\uDCAC",
  postgres: "\uD83D\uDC18",
  http: "\uD83C\uDF10",
  mcp: "\uD83D\uDD27",
};

interface ConnectorCardProps {
  connector: {
    id: string;
    name: string;
    type: string;
    status: "active" | "disconnected" | "error";
    toolCount: number;
  };
}

export function ConnectorCard({ connector }: ConnectorCardProps) {
  const icon = typeIcons[connector.type] ?? "\uD83D\uDD0C";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{icon}</span>
            <div>
              <CardTitle className="text-base">{connector.name}</CardTitle>
              <Badge variant="secondary" className="mt-1 text-[10px]">
                {connector.type}
              </Badge>
            </div>
          </div>
          <Badge
            variant={connector.status === "active" ? "default" : "destructive"}
            className={connector.status === "active" ? "bg-green-600 hover:bg-green-600/80" : ""}
          >
            {connector.status === "active"
              ? "Active"
              : connector.status === "error"
                ? "Error"
                : "Disconnected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">{connector.toolCount} tools</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            Test
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
