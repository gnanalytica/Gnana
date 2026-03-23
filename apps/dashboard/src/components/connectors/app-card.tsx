"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const categoryColors: Record<string, string> = {
  Development: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  Communication: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  CRM: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  Productivity: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  Database: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  Custom: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

/** The set of connector IDs that have real implementations. */
const IMPLEMENTED_CONNECTORS = new Set(["github", "slack", "http-api", "postgres", "mcp-server"]);

export interface AppInfo {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  authType: "oauth" | "api_key" | "mcp";
}

interface AppCardProps {
  app: AppInfo;
  installedConnectorTypes: Set<string>;
  onInstall: (app: AppInfo) => void;
}

/** Map app store IDs to the connector `type` values returned by the API. */
function appIdToConnectorType(appId: string): string {
  switch (appId) {
    case "http-api":
      return "http";
    case "mcp-server":
      return "mcp";
    default:
      return appId;
  }
}

export function AppCard({ app, installedConnectorTypes, onInstall }: AppCardProps) {
  const isImplemented = IMPLEMENTED_CONNECTORS.has(app.id);
  const isInstalled = installedConnectorTypes.has(appIdToConnectorType(app.id));

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl shrink-0">{app.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{app.name}</span>
              <Badge
                variant="outline"
                className={`text-[10px] border-0 ${categoryColors[app.category] ?? ""}`}
              >
                {app.category}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1 truncate">{app.description}</p>
          </div>
          <div className="shrink-0">
            {isInstalled ? (
              <Badge variant="secondary" className="text-xs">
                Connected
              </Badge>
            ) : !isImplemented ? (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Coming Soon
              </Badge>
            ) : (
              <Button size="sm" onClick={() => onInstall(app)}>
                Install
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
