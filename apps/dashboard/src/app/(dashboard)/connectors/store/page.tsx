"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppCard, type AppInfo } from "@/components/connectors/app-card";
import { InstallDialog } from "@/components/connectors/install-dialog";

const apps: AppInfo[] = [
  {
    id: "github",
    name: "GitHub",
    icon: "\uD83D\uDC19",
    category: "Development",
    description: "Issues, PRs, code search, commits",
    authType: "oauth",
    installed: true,
  },
  {
    id: "slack",
    name: "Slack",
    icon: "\uD83D\uDCAC",
    category: "Communication",
    description: "Messages, channels, threads",
    authType: "oauth",
    installed: true,
  },
  {
    id: "notion",
    name: "Notion",
    icon: "\uD83D\uDCDD",
    category: "Productivity",
    description: "Pages, databases, blocks",
    authType: "oauth",
    installed: false,
  },
  {
    id: "hubspot",
    name: "HubSpot",
    icon: "\uD83D\uDFE0",
    category: "CRM",
    description: "Contacts, deals, companies",
    authType: "oauth",
    installed: false,
  },
  {
    id: "jira",
    name: "Jira",
    icon: "\uD83D\uDD35",
    category: "Development",
    description: "Issues, sprints, boards",
    authType: "oauth",
    installed: false,
  },
  {
    id: "linear",
    name: "Linear",
    icon: "\uD83D\uDFE3",
    category: "Development",
    description: "Issues, projects, cycles",
    authType: "oauth",
    installed: false,
  },
  {
    id: "google-workspace",
    name: "Google Workspace",
    icon: "\uD83D\uDCE7",
    category: "Productivity",
    description: "Gmail, Drive, Calendar, Sheets",
    authType: "oauth",
    installed: false,
  },
  {
    id: "salesforce",
    name: "Salesforce",
    icon: "\u2601\uFE0F",
    category: "CRM",
    description: "Leads, opportunities, accounts",
    authType: "oauth",
    installed: false,
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    icon: "\uD83D\uDC18",
    category: "Database",
    description: "Query, tables, schema inspection",
    authType: "api_key",
    installed: true,
  },
  {
    id: "mysql",
    name: "MySQL",
    icon: "\uD83D\uDC2C",
    category: "Database",
    description: "Query, tables, schema",
    authType: "api_key",
    installed: false,
  },
  {
    id: "mongodb",
    name: "MongoDB",
    icon: "\uD83C\uDF43",
    category: "Database",
    description: "Collections, documents, aggregation",
    authType: "api_key",
    installed: false,
  },
  {
    id: "discord",
    name: "Discord",
    icon: "\uD83C\uDFAE",
    category: "Communication",
    description: "Messages, channels, roles",
    authType: "oauth",
    installed: false,
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    icon: "\uD83D\uDFE6",
    category: "Communication",
    description: "Chat, channels, meetings",
    authType: "oauth",
    installed: false,
  },
  {
    id: "airtable",
    name: "Airtable",
    icon: "\uD83D\uDCCA",
    category: "Productivity",
    description: "Bases, tables, records",
    authType: "api_key",
    installed: false,
  },
  {
    id: "http-api",
    name: "HTTP API",
    icon: "\uD83C\uDF10",
    category: "Custom",
    description: "Connect any REST API endpoint",
    authType: "api_key",
    installed: true,
  },
  {
    id: "mcp-server",
    name: "MCP Server",
    icon: "\uD83D\uDD27",
    category: "Custom",
    description: "Connect a Model Context Protocol server",
    authType: "mcp",
    installed: false,
  },
];

const categories = [
  "All",
  "Communication",
  "Development",
  "CRM",
  "Productivity",
  "Database",
  "Custom",
];

export default function AppStorePage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [installApp, setInstallApp] = useState<AppInfo | null>(null);

  const filteredApps = useMemo(() => {
    let result = apps;
    if (category !== "All") {
      result = result.filter((app) => app.category === category);
    }
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(
        (app) =>
          app.name.toLowerCase().includes(query) || app.description.toLowerCase().includes(query),
      );
    }
    return result;
  }, [search, category]);

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">App Store</h1>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search apps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Category Tabs */}
      <Tabs value={category} onValueChange={setCategory}>
        <TabsList>
          {categories.map((cat) => (
            <TabsTrigger key={cat} value={cat}>
              {cat}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* App Grid */}
      {filteredApps.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filteredApps.map((app) => (
            <AppCard key={app.id} app={app} onInstall={setInstallApp} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground">No apps match your search.</p>
        </div>
      )}

      {/* Install Dialog */}
      <InstallDialog
        app={installApp ? { name: installApp.name, type: installApp.authType } : null}
        isOpen={!!installApp}
        onClose={() => setInstallApp(null)}
        onInstall={() => {}}
      />
    </div>
  );
}
