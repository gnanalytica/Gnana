"use client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Trash2, AlertTriangle } from "lucide-react";
import type { Node } from "@xyflow/react";
import type { ValidationError } from "@/lib/canvas/validation-types";

interface ConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  node: Node | null;
  validationErrors?: ValidationError[];
  onUpdate: (data: Record<string, unknown>) => void;
  onDelete: () => void;
}

export function ConfigDrawer({ isOpen, onClose, node, validationErrors = [], onUpdate, onDelete }: ConfigDrawerProps) {
  if (!node) return null;
  const d = node.data as Record<string, unknown>;
  const nodeType = node.type;

  const title = (() => {
    if (d.phase) return `Configure ${d.phase as string}`;
    if (nodeType === "trigger") return "Configure Trigger";
    if (nodeType === "humanGate") return "Configure Approval Gate";
    if (nodeType === "condition") return "Configure Condition";
    if (nodeType === "loop") return "Configure Loop";
    if (nodeType === "parallel") return "Configure Parallel";
    if (nodeType === "merge") return "Configure Merge";
    if (nodeType === "transform") return "Configure Transform";
    if (nodeType === "tool") return "Configure Tool";
    if (nodeType === "output") return "Configure Output";
    return "Configure Node";
  })();

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="space-y-1">
              {validationErrors.map((err, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
                    err.severity === "error"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-amber-500/10 text-amber-600"
                  }`}
                >
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{err.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* LLM node config */}
          {typeof d.phase === "string" && (
            <>
              <div>
                <Label>Model</Label>
                <Select
                  defaultValue={d.model as string}
                  onValueChange={(value) => onUpdate({ model: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Claude Sonnet 4">Claude Sonnet 4</SelectItem>
                    <SelectItem value="Claude Opus 4">Claude Opus 4</SelectItem>
                    <SelectItem value="Gemini 2.5 Flash">Gemini 2.5 Flash</SelectItem>
                    <SelectItem value="Gemini 2.5 Pro">Gemini 2.5 Pro</SelectItem>
                    <SelectItem value="GPT-4.1">GPT-4.1</SelectItem>
                    <SelectItem value="GPT-4.1 mini">GPT-4.1 mini</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Provider</Label>
                <Select
                  defaultValue={d.provider as string}
                  onValueChange={(value) => onUpdate({ provider: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Anthropic">Anthropic</SelectItem>
                    <SelectItem value="Google">Google</SelectItem>
                    <SelectItem value="OpenAI">OpenAI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Temperature</Label>
                <Input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  defaultValue={(d.temperature as number) ?? 0.7}
                  onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
                />
              </div>
              <div>
                <Label>Max Tokens</Label>
                <Input
                  type="number"
                  defaultValue={(d.maxTokens as number) ?? 4096}
                  onChange={(e) => onUpdate({ maxTokens: parseInt(e.target.value, 10) })}
                />
              </div>
              <div>
                <Label>System Prompt Override</Label>
                <Textarea
                  rows={3}
                  placeholder="Optional per-node system prompt..."
                  defaultValue={(d.systemPrompt as string) ?? ""}
                  onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
                />
              </div>
            </>
          )}

          {/* Trigger config */}
          {nodeType === "trigger" && (
            <div>
              <Label>Trigger Type</Label>
              <Select
                defaultValue={(d.triggerType as string) ?? "Manual"}
                onValueChange={(value) => onUpdate({ triggerType: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Manual">Manual</SelectItem>
                  <SelectItem value="Webhook">Webhook</SelectItem>
                  <SelectItem value="Cron">Cron Schedule</SelectItem>
                  <SelectItem value="Event">Event</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Human Gate config */}
          {nodeType === "humanGate" && (
            <>
              <div>
                <Label>Approval Mode</Label>
                <Select
                  defaultValue={(d.approval as string) ?? "required"}
                  onValueChange={(value) => onUpdate({ approval: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="required">Always Required</SelectItem>
                    <SelectItem value="auto">Auto-approve</SelectItem>
                    <SelectItem value="conditional">Conditional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Approval Message</Label>
                <Textarea
                  rows={2}
                  placeholder="Message shown to approver..."
                  defaultValue={(d.message as string) ?? ""}
                  onChange={(e) => onUpdate({ message: e.target.value })}
                />
              </div>
              <div>
                <Label>Timeout (seconds)</Label>
                <Input
                  type="number"
                  min={0}
                  defaultValue={(d.timeout as number) ?? 0}
                  onChange={(e) => onUpdate({ timeout: parseInt(e.target.value, 10) })}
                />
              </div>
            </>
          )}

          {/* Condition config */}
          {nodeType === "condition" && (
            <>
              <div>
                <Label>Condition Expression</Label>
                <Textarea
                  rows={2}
                  placeholder="e.g. result.score > 0.8"
                  defaultValue={(d.expression as string) ?? ""}
                  onChange={(e) => onUpdate({ expression: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>True Label</Label>
                  <Input
                    defaultValue={(d.trueLabel as string) ?? "True"}
                    onChange={(e) => onUpdate({ trueLabel: e.target.value })}
                  />
                </div>
                <div>
                  <Label>False Label</Label>
                  <Input
                    defaultValue={(d.falseLabel as string) ?? "False"}
                    onChange={(e) => onUpdate({ falseLabel: e.target.value })}
                  />
                </div>
              </div>
            </>
          )}

          {/* Tool config */}
          {nodeType === "tool" && (
            <>
              <div>
                <Label>Connector</Label>
                <Select
                  defaultValue={(d.connector as string) ?? ""}
                  onValueChange={(value) => onUpdate({ connector: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select connector..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="github">GitHub</SelectItem>
                    <SelectItem value="slack">Slack</SelectItem>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="database">Database</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tool Name</Label>
                <Input
                  defaultValue={(d.name as string) ?? ""}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  rows={2}
                  defaultValue={(d.description as string) ?? ""}
                  onChange={(e) => onUpdate({ description: e.target.value })}
                />
              </div>
              <div>
                <Label>Output Variable</Label>
                <Input
                  placeholder="e.g. toolResult"
                  defaultValue={(d.outputVar as string) ?? ""}
                  onChange={(e) => onUpdate({ outputVar: e.target.value })}
                />
              </div>
            </>
          )}

          {/* Loop config */}
          {nodeType === "loop" && (
            <>
              <div>
                <Label>Max Iterations</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={(d.maxIterations as number) ?? 5}
                  onChange={(e) => onUpdate({ maxIterations: parseInt(e.target.value, 10) })}
                />
              </div>
              <div>
                <Label>Until Condition</Label>
                <Textarea
                  rows={2}
                  placeholder="e.g. result.complete === true"
                  defaultValue={(d.untilCondition as string) ?? ""}
                  onChange={(e) => onUpdate({ untilCondition: e.target.value })}
                />
              </div>
            </>
          )}

          {/* Parallel config */}
          {nodeType === "parallel" && (
            <div>
              <Label>Number of Branches</Label>
              <Input
                type="number"
                min={2}
                max={10}
                defaultValue={(d.branches as number) ?? 2}
                onChange={(e) => onUpdate({ branches: parseInt(e.target.value, 10) })}
              />
            </div>
          )}

          {/* Merge config */}
          {nodeType === "merge" && (
            <div>
              <Label>Number of Inputs</Label>
              <Input
                type="number"
                min={2}
                max={10}
                defaultValue={(d.inputs as number) ?? 2}
                onChange={(e) => onUpdate({ inputs: parseInt(e.target.value, 10) })}
              />
            </div>
          )}

          {/* Transform config */}
          {nodeType === "transform" && (
            <div>
              <Label>Transform Expression</Label>
              <Textarea
                rows={4}
                placeholder={"// JavaScript transform\nreturn { ...input, processed: true }"}
                defaultValue={(d.expression as string) ?? ""}
                onChange={(e) => onUpdate({ expression: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
          )}

          {/* Output config */}
          {nodeType === "output" && (
            <div>
              <Label>Output Label</Label>
              <Input
                defaultValue={(d.label as string) ?? "Result"}
                onChange={(e) => onUpdate({ label: e.target.value })}
              />
            </div>
          )}

          {/* Delete button — always shown, except trigger */}
          {nodeType !== "trigger" && (
            <div className="pt-4 border-t">
              <Button variant="destructive" className="w-full gap-2" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
                Delete Node
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
