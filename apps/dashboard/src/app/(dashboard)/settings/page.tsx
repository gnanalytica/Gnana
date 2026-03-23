"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  const [workspaceName, setWorkspaceName] = useState("My Workspace");
  const [approvalMode, setApprovalMode] = useState("required");
  const [maxConcurrent, setMaxConcurrent] = useState("10");
  const [theme, setTheme] = useState("system");

  return (
    <div className="p-8 max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your workspace preferences.</p>
      </div>

      <Separator />

      <div className="space-y-6">
        {/* Workspace Name */}
        <div className="space-y-2">
          <Label htmlFor="workspace-name">Workspace Name</Label>
          <Input
            id="workspace-name"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
        </div>

        {/* Default Approval Mode */}
        <div className="space-y-2">
          <Label htmlFor="approval-mode">Default Approval Mode</Label>
          <Select value={approvalMode} onValueChange={setApprovalMode}>
            <SelectTrigger id="approval-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="required">Required</SelectItem>
              <SelectItem value="auto">Auto-approve</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Max Concurrent Runs */}
        <div className="space-y-2">
          <Label htmlFor="max-concurrent">Max Concurrent Runs</Label>
          <Input
            id="max-concurrent"
            type="number"
            min={1}
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(e.target.value)}
          />
        </div>

        {/* Theme Preference */}
        <div className="space-y-2">
          <Label htmlFor="theme">Theme Preference</Label>
          <Select value={theme} onValueChange={setTheme}>
            <SelectTrigger id="theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button>Save</Button>
    </div>
  );
}
