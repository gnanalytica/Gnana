"use client";

import Link from "next/link";
import { Plus, Store, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectorCard } from "@/components/connectors/connector-card";
import { useConnectors } from "@/lib/hooks/use-connectors";

export default function ConnectorsPage() {
  const { connectors, isLoading, error, deleteConnector, testConnector, refreshTools } = useConnectors();

  if (error) {
    return (
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Connectors</h1>
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">Cannot connect to server</p>
              <p className="text-sm text-muted-foreground">
                Make sure the Gnana server is running at{" "}
                {process.env.NEXT_PUBLIC_GNANA_API_URL ?? "http://localhost:4000"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Connectors</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/connectors/store">
              <Plus className="h-4 w-4" />
              Add MCP Server
            </Link>
          </Button>
          <Button asChild>
            <Link href="/connectors/store">
              <Store className="h-4 w-4" />
              Browse App Store
            </Link>
          </Button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded" />
                    <div>
                      <Skeleton className="h-5 w-28" />
                      <Skeleton className="h-4 w-14 mt-1 rounded-full" />
                    </div>
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-24 mb-4" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-16 rounded-md" />
                  <Skeleton className="h-8 w-20 rounded-md" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : /* Connector Grid or Empty State */
      connectors.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {connectors.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              onTest={testConnector}
              onDelete={deleteConnector}
              onRefreshTools={refreshTools}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground mb-4">No connectors installed.</p>
          <Button asChild>
            <Link href="/connectors/store">
              <Store className="h-4 w-4" />
              Browse App Store
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
