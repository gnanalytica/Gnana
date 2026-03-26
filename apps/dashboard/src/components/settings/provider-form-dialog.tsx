"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import type { ProviderRow, ProviderType } from "./provider-card";

interface ProviderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: ProviderRow;
  onSaved: (provider: ProviderRow) => void;
}

const PROVIDER_TYPE_NAMES: Record<ProviderType, string> = {
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

interface TestResult {
  ok: boolean;
  provider: string;
  error?: string;
  latencyMs: number;
  modelCount?: number;
}

export function ProviderFormDialog({
  open,
  onOpenChange,
  provider,
  onSaved,
}: ProviderFormDialogProps) {
  const isEdit = !!provider;

  const [type, setType] = useState<ProviderType>("anthropic");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens or provider changes
  useEffect(() => {
    if (open) {
      if (provider) {
        setType(provider.type);
        setName(provider.name);
        setApiKey("");
        setBaseUrl(provider.baseUrl ?? "");
        setIsDefault(provider.isDefault);
      } else {
        setType("anthropic");
        setName("Anthropic");
        setApiKey("");
        setBaseUrl("");
        setIsDefault(false);
      }
      setTestResult(null);
      setError(null);
    }
  }, [open, provider]);

  // Auto-fill name when type changes (add mode only)
  const handleTypeChange = useCallback(
    (newType: ProviderType) => {
      setType(newType);
      if (!isEdit) {
        setName(PROVIDER_TYPE_NAMES[newType]);
      }
      // Auto-fill base URL for OpenRouter
      if (newType === "openrouter" && !baseUrl) {
        setBaseUrl("https://openrouter.ai/api/v1");
      } else if (newType !== "openrouter" && baseUrl === "https://openrouter.ai/api/v1") {
        setBaseUrl("");
      }
      setTestResult(null);
    },
    [isEdit, baseUrl],
  );

  // Test connection handler
  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      if (isEdit && !apiKey) {
        // Test stored credentials
        const res = await api.fetch(`/api/providers/${provider!.id}/test`, {
          method: "POST",
        });
        const result: TestResult = await res.json();
        setTestResult(result);
      } else {
        // Test unsaved credentials
        const res = await api.fetch("/api/providers/test", {
          method: "POST",
          body: JSON.stringify({
            type,
            apiKey,
            ...(baseUrl && { baseUrl }),
          }),
        });
        const result: TestResult = await res.json();
        setTestResult(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }, [isEdit, apiKey, provider, type, baseUrl]);

  // Save handler
  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      if (isEdit) {
        // Update existing provider
        const body: Record<string, unknown> = { name, isDefault };
        if (apiKey) body.apiKey = apiKey;
        if (type !== provider!.type) body.type = type;
        if (baseUrl || baseUrl !== (provider!.baseUrl ?? "")) body.baseUrl = baseUrl || null;

        const res = await api.fetch(`/api/providers/${provider!.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        const updated: ProviderRow = await res.json();
        onSaved(updated);
      } else {
        // Create new provider
        const res = await api.fetch("/api/providers", {
          method: "POST",
          body: JSON.stringify({
            type,
            name,
            apiKey,
            ...(baseUrl && { baseUrl }),
            isDefault,
          }),
        });
        const created: ProviderRow = await res.json();
        onSaved(created);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider");
    } finally {
      setSaving(false);
    }
  }, [isEdit, type, name, apiKey, baseUrl, isDefault, provider, onSaved, onOpenChange]);

  const canSave = isEdit
    ? name.trim().length > 0
    : name.trim().length > 0 && apiKey.trim().length > 0;

  const canTest = isEdit
    ? true // Can test stored credentials even without new key
    : apiKey.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Provider" : "Add Provider"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the provider configuration." : "Connect an LLM provider to Gnana."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Provider Type */}
          <div className="space-y-2">
            <Label htmlFor="provider-type">Provider Type</Label>
            <Select
              value={type}
              onValueChange={(v) => handleTypeChange(v as ProviderType)}
              disabled={isEdit}
            >
              <SelectTrigger id="provider-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="provider-name">Name</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Anthropic Production"
            />
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor="provider-key">API Key</Label>
            <Input
              id="provider-key"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestResult(null);
              }}
              placeholder={isEdit ? "Leave blank to keep current key" : "sk-..."}
            />
          </div>

          {/* Base URL -- always shown for OpenRouter, optional for others */}
          {(type === "openrouter" || baseUrl) && (
            <div className="space-y-2">
              <Label htmlFor="provider-base-url">
                Base URL {type !== "openrouter" && "(optional)"}
              </Label>
              <Input
                id="provider-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
              />
              <p className="text-xs text-muted-foreground">
                {type === "openrouter"
                  ? "OpenRouter API base URL."
                  : "Only needed for custom proxies or OpenRouter."}
              </p>
            </div>
          )}

          {/* Test result inline display */}
          {testResult && (
            <div
              className={`rounded-md p-3 text-sm ${
                testResult.ok
                  ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                  : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
              }`}
            >
              <div className="flex items-center gap-2">
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0" />
                )}
                <span className="font-medium">
                  {testResult.ok
                    ? `Connection successful (${testResult.latencyMs}ms)`
                    : "Connection failed"}
                </span>
              </div>
              {testResult.ok && testResult.modelCount !== undefined && (
                <p className="mt-1 ml-6">
                  {testResult.modelCount} {testResult.modelCount === 1 ? "model" : "models"}{" "}
                  available
                </p>
              )}
              {!testResult.ok && testResult.error && (
                <p className="mt-1 ml-6">{testResult.error}</p>
              )}
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Set as default checkbox */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="provider-default"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor="provider-default" className="text-sm font-normal">
              Set as default provider
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleTest} disabled={!canTest || testing}>
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            Test Connection
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save Changes" : "Add Provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
