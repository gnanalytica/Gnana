"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import {
  ProviderCard,
  type ProviderRow,
  type ConnectionStatus,
} from "@/components/settings/provider-card";
import { ProviderFormDialog } from "@/components/settings/provider-form-dialog";

interface TestResult {
  ok: boolean;
  provider: string;
  error?: string;
  latencyMs: number;
  modelCount?: number;
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderRow | undefined>(undefined);

  // Track which provider is currently being tested
  const [testingId, setTestingId] = useState<string | null>(null);

  // Fetch providers from API
  const fetchProviders = useCallback(async () => {
    try {
      setError(null);
      const res = await api.fetch("/api/providers");
      const json = await res.json();
      const data = (json.data ?? []) as ProviderRow[];
      // Preserve client-side status from previous state
      setProviders((prev) => {
        const statusMap = new Map(
          prev.map((p) => [
            p.id,
            { status: p.status, statusMessage: p.statusMessage, modelCount: p.modelCount },
          ]),
        );
        return data.map((p) => ({
          ...p,
          status: statusMap.get(p.id)?.status,
          statusMessage: statusMap.get(p.id)?.statusMessage,
          modelCount: statusMap.get(p.id)?.modelCount,
        }));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Test connection handler
  const handleTest = useCallback(async (provider: ProviderRow) => {
    setTestingId(provider.id);
    try {
      const res = await api.fetch(`/api/providers/${provider.id}/test`, {
        method: "POST",
      });
      const result: TestResult = await res.json();
      setProviders((prev) =>
        prev.map((p) =>
          p.id === provider.id
            ? {
                ...p,
                status: (result.ok ? "connected" : "error") as ConnectionStatus,
                statusMessage: result.ok ? undefined : result.error,
                modelCount: result.modelCount,
              }
            : p,
        ),
      );
    } catch (err) {
      setProviders((prev) =>
        prev.map((p) =>
          p.id === provider.id
            ? {
                ...p,
                status: "error" as ConnectionStatus,
                statusMessage: err instanceof Error ? err.message : "Test failed",
              }
            : p,
        ),
      );
    } finally {
      setTestingId(null);
    }
  }, []);

  // Delete handler
  const handleDelete = useCallback(
    async (provider: ProviderRow) => {
      try {
        await api.fetch(`/api/providers/${provider.id}`, { method: "DELETE" });
        await fetchProviders();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete provider");
      }
    },
    [fetchProviders],
  );

  // Set default handler
  const handleSetDefault = useCallback(
    async (provider: ProviderRow) => {
      try {
        await api.fetch(`/api/providers/${provider.id}/default`, { method: "PUT" });
        await fetchProviders();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to set default provider");
      }
    },
    [fetchProviders],
  );

  // Edit handler
  const handleEdit = useCallback((provider: ProviderRow) => {
    setEditingProvider(provider);
    setDialogOpen(true);
  }, []);

  // Add handler
  const handleAdd = useCallback(() => {
    setEditingProvider(undefined);
    setDialogOpen(true);
  }, []);

  // After save callback
  const handleSaved = useCallback(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Check if there is a default provider
  const hasDefault = providers.some((p) => p.isDefault);

  // ---- Render ----

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Providers</h1>
          <p className="text-muted-foreground mt-1">
            Manage LLM provider connections.
          </p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="h-4 w-4" />
          Add Provider
        </Button>
      </div>

      {/* No default provider warning */}
      {!loading && providers.length > 0 && !hasDefault && (
        <div className="flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            No default provider set. Set a default provider so agents have a
            fallback LLM connection.
          </span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border p-5 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && providers.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
          <AlertTriangle className="h-10 w-10 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold">No LLM providers configured</h2>
          <p className="text-muted-foreground mt-2 max-w-md">
            Add an LLM provider to start running agents. Gnana supports
            Anthropic, Google, OpenAI, and OpenRouter.
          </p>
          <Button className="mt-6" onClick={handleAdd}>
            <Plus className="h-4 w-4" />
            Add Provider
          </Button>
        </div>
      )}

      {/* Provider cards grid */}
      {!loading && providers.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onSetDefault={handleSetDefault}
              onTest={handleTest}
              testing={testingId === provider.id}
            />
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <ProviderFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        provider={editingProvider}
        onSaved={handleSaved}
      />
    </div>
  );
}
