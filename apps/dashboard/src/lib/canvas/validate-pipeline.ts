import type { NodeSpec, EdgeSpec } from "@/types/pipeline";
import type { ValidationError, ValidationResult } from "./validation-types";

/** Validate a single node */
export function validateNode(node: NodeSpec): ValidationError[] {
  const errors: ValidationError[] = [];
  const d = node.data;

  switch (node.type) {
    case "llm":
      if (!d.model) {
        errors.push({ nodeId: node.id, field: "model", message: "Model is required", severity: "error" });
      }
      if (!d.provider) {
        errors.push({ nodeId: node.id, field: "provider", message: "Provider is required", severity: "error" });
      }
      break;
    case "tool":
      if (!d.name || d.name === "Unnamed") {
        errors.push({ nodeId: node.id, field: "name", message: "Tool name is required", severity: "error" });
      }
      if (!d.connector) {
        errors.push({ nodeId: node.id, field: "connector", message: "Connector recommended", severity: "warning" });
      }
      break;
    case "condition":
      if (!d.expression || d.expression === "if ...") {
        errors.push({ nodeId: node.id, field: "expression", message: "Condition expression is required", severity: "error" });
      }
      break;
  }

  return errors;
}

/** Validate the entire pipeline */
export function validatePipeline(nodes: NodeSpec[], edges: EdgeSpec[]): ValidationResult {
  const allErrors: ValidationError[] = [];

  // Per-node validation
  for (const node of nodes) {
    allErrors.push(...validateNode(node));
  }

  // Pipeline-level: exactly one trigger
  const triggers = nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) {
    allErrors.push({ nodeId: "", message: "Pipeline must have at least one trigger", severity: "error" });
  } else if (triggers.length > 1) {
    allErrors.push({ nodeId: "", message: "Pipeline should have exactly one trigger", severity: "warning" });
  }

  // At least one output
  const outputs = nodes.filter((n) => n.type === "output");
  if (outputs.length === 0) {
    allErrors.push({ nodeId: "", message: "Pipeline should have at least one output node", severity: "warning" });
  }

  // Orphan detection — nodes with no edges
  const connectedIds = new Set<string>();
  for (const edge of edges) {
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }
  for (const node of nodes) {
    if (!connectedIds.has(node.id) && nodes.length > 1) {
      allErrors.push({
        nodeId: node.id,
        message: `"${node.type}" node is disconnected`,
        severity: "warning",
      });
    }
  }

  return {
    valid: allErrors.filter((e) => e.severity === "error").length === 0,
    errors: allErrors.filter((e) => e.severity === "error"),
    warnings: allErrors.filter((e) => e.severity === "warning"),
  };
}
