"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Plan } from "@/types";

interface ApprovalGateProps {
  plan: Plan;
  onApprove: (modifications?: string) => void;
  onReject: (reason?: string) => void;
}

export function ApprovalGate({ plan, onApprove, onReject }: ApprovalGateProps) {
  const [modifications, setModifications] = useState("");
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  function handleApprove() {
    onApprove(modifications.trim() || undefined);
  }

  function handleReject() {
    if (!showRejectReason) {
      setShowRejectReason(true);
      return;
    }
    onReject(rejectReason.trim() || undefined);
  }

  return (
    <Card className="border-amber-500/50">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-amber-500" />
          <CardTitle className="text-lg">Plan Awaiting Approval</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Plan summary */}
        <p className="text-sm text-muted-foreground">{plan.summary}</p>

        {/* Steps list */}
        <ol className="space-y-2">
          {plan.steps.map((step) => (
            <li key={step.order} className="flex gap-3">
              <span className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-medium shrink-0">
                {step.order}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* Modifications textarea */}
        <div>
          <label htmlFor="modifications" className="text-xs font-medium text-muted-foreground">
            Modifications (optional)
          </label>
          <Textarea
            id="modifications"
            value={modifications}
            onChange={(e) => setModifications(e.target.value)}
            placeholder="Add any modifications to the plan before approving..."
            className="mt-1"
            rows={3}
          />
        </div>

        {/* Reject reason (shown when reject is clicked once) */}
        {showRejectReason && (
          <div>
            <label htmlFor="reject-reason" className="text-xs font-medium text-muted-foreground">
              Rejection Reason (optional)
            </label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why this plan is being rejected..."
              className="mt-1"
              rows={2}
            />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleApprove}>Approve</Button>
          <Button variant="destructive" onClick={handleReject}>
            {showRejectReason ? "Confirm Reject" : "Reject"}
          </Button>
          {showRejectReason && (
            <Button
              variant="ghost"
              onClick={() => {
                setShowRejectReason(false);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
