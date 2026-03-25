"use client";

import { useState } from "react";
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  Star,
  Wifi,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ProviderType = "anthropic" | "google" | "openai" | "openrouter";
export type ConnectionStatus = "connected" | "error" | "untested";

export interface ProviderRow {
  id: string;
  name: string;
  type: ProviderType;
  apiKey: string;
  baseUrl?: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  // Client-side state (not from API)
  status?: ConnectionStatus;
  statusMessage?: string;
  modelCount?: number;
}

interface ProviderCardProps {
  provider: ProviderRow;
  onEdit: (provider: ProviderRow) => void;
  onDelete: (provider: ProviderRow) => void;
  onSetDefault: (provider: ProviderRow) => void;
  onTest: (provider: ProviderRow) => void;
  testing?: boolean;
}

const PROVIDER_COLORS: Record<ProviderType, string> = {
  anthropic: "bg-orange-500/10 text-orange-600 border-orange-200",
  google: "bg-blue-500/10 text-blue-600 border-blue-200",
  openai: "bg-green-500/10 text-green-600 border-green-200",
  openrouter: "bg-purple-500/10 text-purple-600 border-purple-200",
};

const PROVIDER_LABELS: Record<ProviderType, string> = {
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

const STATUS_INDICATORS: Record<ConnectionStatus, { dot: string; label: string }> = {
  connected: { dot: "bg-green-500", label: "Connected" },
  error: { dot: "bg-red-500", label: "Error" },
  untested: { dot: "bg-gray-400", label: "Not tested" },
};

export function ProviderCard({
  provider,
  onEdit,
  onDelete,
  onSetDefault,
  onTest,
  testing,
}: ProviderCardProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const status = provider.status ?? "untested";
  const statusInfo = STATUS_INDICATORS[status];
  const colorClass = PROVIDER_COLORS[provider.type] ?? "";

  return (
    <>
      <Card className="transition-colors hover:border-foreground/20">
        <CardContent className="p-5">
          {/* Header row: icon area, name, default badge */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${colorClass}`}
              >
                {provider.type.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold truncate">{provider.name}</h3>
                  {provider.isDefault && (
                    <Badge variant="secondary" className="shrink-0 gap-1 text-xs">
                      <Star className="h-3 w-3 fill-current" />
                      Default
                    </Badge>
                  )}
                </div>
                {/* Details row */}
                <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                  <span>{PROVIDER_LABELS[provider.type]}</span>
                  <span>{"·"}</span>
                  {provider.modelCount !== undefined && (
                    <>
                      <span>
                        {provider.modelCount} {provider.modelCount === 1 ? "model" : "models"}
                      </span>
                      <span>{"·"}</span>
                    </>
                  )}
                  <div className="flex items-center gap-1.5">
                    <div className={`h-2 w-2 rounded-full ${statusInfo.dot}`} />
                    <span>{statusInfo.label}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(provider)}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTest(provider)} disabled={testing}>
                  {testing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wifi className="h-4 w-4" />
                  )}
                  Test Connection
                </DropdownMenuItem>
                {!provider.isDefault && (
                  <DropdownMenuItem onClick={() => onSetDefault(provider)}>
                    <Star className="h-4 w-4" />
                    Set as Default
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Error message row */}
          {status === "error" && provider.statusMessage && (
            <div className="mt-3 rounded-md bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
              {provider.statusMessage}
            </div>
          )}

          {/* Masked API key */}
          <div className="mt-3 text-xs font-mono text-muted-foreground">
            {provider.apiKey}
          </div>
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{provider.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the provider and its API key. Agents using this
              provider will fail until a new one is configured.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={() => {
                onDelete(provider);
                setDeleteDialogOpen(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
