"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  models: string[];
  status: "active" | "inactive";
}

const placeholderProviders: ProviderRow[] = [
  {
    id: "p-1",
    name: "Anthropic",
    type: "Anthropic",
    models: ["Claude Opus", "Claude Sonnet", "Claude Haiku"],
    status: "active",
  },
  {
    id: "p-2",
    name: "Google",
    type: "Google",
    models: ["Gemini Pro", "Gemini Flash"],
    status: "active",
  },
  {
    id: "p-3",
    name: "OpenAI",
    type: "OpenAI",
    models: ["GPT-4o", "GPT-4o-mini", "o1"],
    status: "active",
  },
];

export default function ProvidersPage() {
  const [providers] = useState<ProviderRow[]>(placeholderProviders);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newType, setNewType] = useState("");
  const [newApiKey, setNewApiKey] = useState("");

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Providers</h1>
          <p className="text-muted-foreground mt-1">Manage LLM provider connections.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Provider
        </Button>
      </div>

      {/* Provider Table */}
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">Name</th>
              <th className="text-left p-3 font-medium">Type</th>
              <th className="text-left p-3 font-medium">Models</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.id} className="border-b last:border-b-0">
                <td className="p-3 font-medium">{provider.name}</td>
                <td className="p-3">{provider.type}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {provider.models.map((model) => (
                      <Badge key={model} variant="secondary" className="text-xs">
                        {model}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="p-3">
                  <Badge
                    variant={provider.status === "active" ? "default" : "secondary"}
                    className={
                      provider.status === "active" ? "bg-green-600 hover:bg-green-600/80" : ""
                    }
                  >
                    {provider.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="p-3">
                  <Button variant="ghost" size="sm">
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Provider Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Provider</DialogTitle>
            <DialogDescription>Connect a new LLM provider to your workspace.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider-type">Provider Type</Label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger id="provider-type">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-key">API Key</Label>
              <Input
                id="provider-key"
                type="password"
                placeholder="sk-..."
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline">Test Connection</Button>
            <Button disabled={!newType || !newApiKey.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
