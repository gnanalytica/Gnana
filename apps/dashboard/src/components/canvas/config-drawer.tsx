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

interface ConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  nodeData: any;
  onUpdate: (data: any) => void;
}

export function ConfigDrawer({ isOpen, onClose, nodeData, onUpdate }: ConfigDrawerProps) {
  if (!nodeData) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Configure {nodeData.phase ?? nodeData.type ?? "Node"}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          {/* Model selector if it's an LLM node */}
          {nodeData.phase && (
            <>
              <div>
                <Label>Model</Label>
                <Select
                  defaultValue={nodeData.model}
                  onValueChange={(value) => onUpdate({ model: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4</SelectItem>
                    <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                    <SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Temperature</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  defaultValue={nodeData.temperature ?? 0.7}
                  onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
                />
              </div>
              <div>
                <Label>Max Tokens</Label>
                <Input
                  type="number"
                  defaultValue={nodeData.maxTokens ?? 4096}
                  onChange={(e) => onUpdate({ maxTokens: parseInt(e.target.value, 10) })}
                />
              </div>
            </>
          )}
          {/* Trigger config */}
          {nodeData.type === "trigger" && (
            <div>
              <Label>Trigger Type</Label>
              <Select
                defaultValue={nodeData.triggerType ?? "manual"}
                onValueChange={(value) => onUpdate({ triggerType: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="assignment">Assignment</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
