"use client";

import { useState } from "react";
import { Plus, Copy, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ApiKeyRow {
  id: string;
  name: string;
  key: string;
  created: string;
  lastUsed: string;
}

const placeholderKeys: ApiKeyRow[] = [
  {
    id: "key-1",
    name: "Production Key",
    key: "gnana_pk_a1b2c3d4...",
    created: "2026-03-01",
    lastUsed: "2026-03-23",
  },
  {
    id: "key-2",
    name: "Development Key",
    key: "gnana_dk_e5f6g7h8...",
    created: "2026-03-10",
    lastUsed: "2026-03-22",
  },
];

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>(placeholderKeys);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const handleGenerate = () => {
    const fakeKey = `gnana_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    setGeneratedKey(fakeKey);
  };

  const handleCloseGenerate = () => {
    if (generatedKey && newKeyName.trim()) {
      setKeys((prev) => [
        ...prev,
        {
          id: `key-${Date.now()}`,
          name: newKeyName,
          key: generatedKey.slice(0, 16) + "...",
          created: new Date().toISOString().slice(0, 10),
          lastUsed: "Never",
        },
      ]);
    }
    setGenerateOpen(false);
    setNewKeyName("");
    setGeneratedKey(null);
  };

  const handleRevoke = (id: string) => {
    setKeys((prev) => prev.filter((k) => k.id !== id));
    setRevokeId(null);
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-muted-foreground mt-1">Manage API keys for programmatic access.</p>
        </div>
        <Button onClick={() => setGenerateOpen(true)}>
          <Plus className="h-4 w-4" />
          Generate Key
        </Button>
      </div>

      {/* Keys Table */}
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">Name</th>
              <th className="text-left p-3 font-medium">Key</th>
              <th className="text-left p-3 font-medium">Created</th>
              <th className="text-left p-3 font-medium">Last Used</th>
              <th className="text-left p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((apiKey) => (
              <tr key={apiKey.id} className="border-b last:border-b-0">
                <td className="p-3 font-medium">{apiKey.name}</td>
                <td className="p-3">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {apiKey.key}
                  </Badge>
                </td>
                <td className="p-3 text-muted-foreground">{apiKey.created}</td>
                <td className="p-3 text-muted-foreground">{apiKey.lastUsed}</td>
                <td className="p-3">
                  {revokeId === apiKey.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-destructive">Are you sure?</span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleRevoke(apiKey.id)}
                      >
                        Yes, revoke
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRevokeId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setRevokeId(apiKey.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  No API keys. Generate one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Generate Key Dialog */}
      <Dialog
        open={generateOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseGenerate();
          else setGenerateOpen(true);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
            <DialogDescription>Create a new API key for programmatic access.</DialogDescription>
          </DialogHeader>

          {generatedKey ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
                <p className="text-xs text-yellow-800 dark:text-yellow-200">
                  Copy this key now. You will not be able to see it again.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input readOnly value={generatedKey} className="font-mono text-sm" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => navigator.clipboard.writeText(generatedKey)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={handleCloseGenerate} className="w-full">
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Key Name</Label>
                <Input
                  id="key-name"
                  placeholder="e.g., Production Key"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button onClick={handleGenerate} disabled={!newKeyName.trim()} className="w-full">
                  Generate
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
