# Advanced DAG Nodes & Dry-Run Preview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance DAG node implementations with a safe expression evaluator, true parallel execution, configurable merge strategies, and add dry-run preview mode.

**Architecture:** Create a safe expression evaluator (recursive descent parser, no eval). Enhance condition/loop/transform/parallel/merge nodes in the DAG executor. Add dry-run endpoint with mock executors. Dashboard gets a Preview button with execution path highlighting.

**Tech Stack:** @gnana/core (DAG executor), custom expression parser, Hono (dry-run endpoint), React Flow (preview highlighting)

**Spec:** `docs/superpowers/specs/2026-03-25-advanced-dag-preview-design.md`

---

## Wave 1 — All Parallel (Tasks 1, 5, 6 are independent)

### Task 1: Expression Evaluator (Parser + Evaluator)

**Files:**

- Create: `packages/core/src/expression-evaluator.ts`

**Steps:**

- [ ] Create `packages/core/src/expression-evaluator.ts` with the full expression evaluator. This is a standalone module with zero dependencies on other files. It contains a lexer, recursive-descent parser, and tree-walking evaluator.

  ```typescript
  // packages/core/src/expression-evaluator.ts

  // ---- Public Types ----

  export interface ExpressionScope {
    input: unknown;
    context: ExpressionContext;
  }

  export interface ExpressionContext {
    triggerData?: unknown;
    results: Record<string, unknown>;
    iteration?: number;
    runId: string;
  }

  export interface ExpressionResult {
    success: boolean;
    value: unknown;
    error?: string;
  }

  // ---- AST Node Types ----

  type ASTNode =
    | { type: "literal"; value: string | number | boolean | null }
    | { type: "identifier"; name: string }
    | { type: "member"; object: ASTNode; property: ASTNode; computed: boolean }
    | { type: "unary"; operator: "!" | "-" | "typeof"; operand: ASTNode }
    | { type: "binary"; operator: string; left: ASTNode; right: ASTNode }
    | { type: "ternary"; test: ASTNode; consequent: ASTNode; alternate: ASTNode }
    | { type: "call"; callee: ASTNode; args: ASTNode[] }
    | { type: "object"; properties: { key: string; value: ASTNode }[] }
    | { type: "array"; elements: ASTNode[] };

  // ---- Security Constants ----

  const MAX_EXPRESSION_LENGTH = 2048;
  const MAX_AST_DEPTH = 32;
  const MAX_EVAL_STEPS = 10_000;

  const BLOCKED_IDENTIFIERS = new Set([
    "constructor",
    "__proto__",
    "prototype",
    "globalThis",
    "window",
    "global",
    "process",
    "require",
    "import",
    "eval",
    "Function",
  ]);

  const ALLOWED_METHODS = new Set([
    "contains",
    "startsWith",
    "endsWith",
    "substring",
    "toString",
    "toLowerCase",
    "toUpperCase",
    "trim",
    "split",
    "join",
    "length",
    "indexOf",
    "slice",
    "map",
    "filter",
    "includes",
    "keys",
    "values",
    "entries",
  ]);

  // ---- Token Types ----

  type TokenType =
    | "number"
    | "string"
    | "identifier"
    | "operator"
    | "punctuation"
    | "eof";

  interface Token {
    type: TokenType;
    value: string;
    pos: number;
  }

  // ---- Lexer ----

  class Lexer {
    private pos = 0;
    private tokens: Token[] = [];

    constructor(private source: string) {}

    tokenize(): Token[] {
      this.tokens = [];
      this.pos = 0;

      while (this.pos < this.source.length) {
        this.skipWhitespace();
        if (this.pos >= this.source.length) break;

        const ch = this.source[this.pos]!;

        // Numbers
        if (this.isDigit(ch) || (ch === "." && this.pos + 1 < this.source.length && this.isDigit(this.source[this.pos + 1]!))) {
          this.readNumber();
          continue;
        }

        // Strings
        if (ch === '"' || ch === "'") {
          this.readString(ch);
          continue;
        }

        // Identifiers and keywords
        if (this.isIdentStart(ch)) {
          this.readIdentifier();
          continue;
        }

        // Multi-character operators
        if (this.pos + 1 < this.source.length) {
          const two = this.source.slice(this.pos, this.pos + 2);
          if (["==", "!=", ">=", "<=", "&&", "||", "??"].includes(two)) {
            this.tokens.push({ type: "operator", value: two, pos: this.pos });
            this.pos += 2;
            continue;
          }
        }

        // Single-character operators
        if ("+-*/%><!".includes(ch)) {
          this.tokens.push({ type: "operator", value: ch, pos: this.pos });
          this.pos++;
          continue;
        }

        // Punctuation
        if ("(){}[].,;:?".includes(ch)) {
          this.tokens.push({ type: "punctuation", value: ch, pos: this.pos });
          this.pos++;
          continue;
        }

        throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
      }

      this.tokens.push({ type: "eof", value: "", pos: this.pos });
      return this.tokens;
    }

    private skipWhitespace(): void {
      while (this.pos < this.source.length && /\s/.test(this.source[this.pos]!)) {
        this.pos++;
      }
    }

    private isDigit(ch: string): boolean {
      return ch >= "0" && ch <= "9";
    }

    private isIdentStart(ch: string): boolean {
      return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
    }

    private isIdentPart(ch: string): boolean {
      return this.isIdentStart(ch) || this.isDigit(ch);
    }

    private readNumber(): void {
      const start = this.pos;
      while (this.pos < this.source.length && (this.isDigit(this.source[this.pos]!) || this.source[this.pos] === ".")) {
        this.pos++;
      }
      this.tokens.push({ type: "number", value: this.source.slice(start, this.pos), pos: start });
    }

    private readString(quote: string): void {
      const start = this.pos;
      this.pos++; // skip opening quote
      let value = "";
      while (this.pos < this.source.length && this.source[this.pos] !== quote) {
        if (this.source[this.pos] === "\\") {
          this.pos++;
          if (this.pos < this.source.length) {
            const escaped = this.source[this.pos]!;
            switch (escaped) {
              case "n": value += "\n"; break;
              case "t": value += "\t"; break;
              case "\\": value += "\\"; break;
              default: value += escaped;
            }
          }
        } else {
          value += this.source[this.pos];
        }
        this.pos++;
      }
      if (this.pos >= this.source.length) {
        throw new Error(`Unterminated string starting at position ${start}`);
      }
      this.pos++; // skip closing quote
      this.tokens.push({ type: "string", value, pos: start });
    }

    private readIdentifier(): void {
      const start = this.pos;
      while (this.pos < this.source.length && this.isIdentPart(this.source[this.pos]!)) {
        this.pos++;
      }
      const name = this.source.slice(start, this.pos);
      this.tokens.push({ type: "identifier", value: name, pos: start });
    }
  }

  // ---- Parser ----

  class Parser {
    private pos = 0;
    private depth = 0;

    constructor(private tokens: Token[]) {}

    parse(): ASTNode {
      const node = this.parseTernary();
      if (this.current().type !== "eof") {
        throw new Error(`Unexpected token '${this.current().value}' at position ${this.current().pos}`);
      }
      return node;
    }

    private current(): Token {
      return this.tokens[this.pos] ?? { type: "eof", value: "", pos: -1 };
    }

    private advance(): Token {
      const tok = this.current();
      this.pos++;
      return tok;
    }

    private expect(type: TokenType, value?: string): Token {
      const tok = this.current();
      if (tok.type !== type || (value !== undefined && tok.value !== value)) {
        throw new Error(`Expected ${value ?? type} but got '${tok.value}' at position ${tok.pos}`);
      }
      return this.advance();
    }

    private checkDepth(): void {
      if (this.depth > MAX_AST_DEPTH) {
        throw new Error(`Expression exceeds maximum nesting depth of ${MAX_AST_DEPTH}`);
      }
    }

    // Precedence 10: ternary (? :)
    private parseTernary(): ASTNode {
      this.depth++;
      this.checkDepth();
      let node = this.parseNullCoalescing();
      if (this.current().type === "punctuation" && this.current().value === "?") {
        this.advance();
        const consequent = this.parseTernary();
        this.expect("punctuation", ":");
        const alternate = this.parseTernary();
        node = { type: "ternary", test: node, consequent, alternate };
      }
      this.depth--;
      return node;
    }

    // Precedence 9: ?? (null coalescing)
    private parseNullCoalescing(): ASTNode {
      let left = this.parseLogicalOr();
      while (this.current().type === "operator" && this.current().value === "??") {
        this.advance();
        const right = this.parseLogicalOr();
        left = { type: "binary", operator: "??", left, right };
      }
      return left;
    }

    // Precedence 8: || (logical OR)
    private parseLogicalOr(): ASTNode {
      let left = this.parseLogicalAnd();
      while (this.current().type === "operator" && this.current().value === "||") {
        this.advance();
        const right = this.parseLogicalAnd();
        left = { type: "binary", operator: "||", left, right };
      }
      return left;
    }

    // Precedence 7: && (logical AND)
    private parseLogicalAnd(): ASTNode {
      let left = this.parseEquality();
      while (this.current().type === "operator" && this.current().value === "&&") {
        this.advance();
        const right = this.parseEquality();
        left = { type: "binary", operator: "&&", left, right };
      }
      return left;
    }

    // Precedence 6: == != (equality)
    private parseEquality(): ASTNode {
      let left = this.parseComparison();
      while (
        this.current().type === "operator" &&
        (this.current().value === "==" || this.current().value === "!=")
      ) {
        const op = this.advance().value;
        const right = this.parseComparison();
        left = { type: "binary", operator: op, left, right };
      }
      return left;
    }

    // Precedence 5: > < >= <= (comparison)
    private parseComparison(): ASTNode {
      let left = this.parseAdditive();
      while (
        this.current().type === "operator" &&
        (this.current().value === ">" ||
          this.current().value === "<" ||
          this.current().value === ">=" ||
          this.current().value === "<=")
      ) {
        const op = this.advance().value;
        const right = this.parseAdditive();
        left = { type: "binary", operator: op, left, right };
      }
      return left;
    }

    // Precedence 4: + - (additive)
    private parseAdditive(): ASTNode {
      let left = this.parseMultiplicative();
      while (
        this.current().type === "operator" &&
        (this.current().value === "+" || this.current().value === "-")
      ) {
        const op = this.advance().value;
        const right = this.parseMultiplicative();
        left = { type: "binary", operator: op, left, right };
      }
      return left;
    }

    // Precedence 3: * / % (multiplicative)
    private parseMultiplicative(): ASTNode {
      let left = this.parseUnary();
      while (
        this.current().type === "operator" &&
        (this.current().value === "*" ||
          this.current().value === "/" ||
          this.current().value === "%")
      ) {
        const op = this.advance().value;
        const right = this.parseUnary();
        left = { type: "binary", operator: op, left, right };
      }
      return left;
    }

    // Precedence 2: ! - typeof (unary)
    private parseUnary(): ASTNode {
      if (this.current().type === "operator" && this.current().value === "!") {
        this.advance();
        const operand = this.parseUnary();
        return { type: "unary", operator: "!", operand };
      }
      if (this.current().type === "operator" && this.current().value === "-") {
        this.advance();
        const operand = this.parseUnary();
        return { type: "unary", operator: "-", operand };
      }
      if (this.current().type === "identifier" && this.current().value === "typeof") {
        this.advance();
        const operand = this.parseUnary();
        return { type: "unary", operator: "typeof", operand };
      }
      return this.parseCallAndMember();
    }

    // Precedence 1: . [] () (member access and calls)
    private parseCallAndMember(): ASTNode {
      let node = this.parsePrimary();
      while (true) {
        if (this.current().type === "punctuation" && this.current().value === ".") {
          this.advance();
          const prop = this.expect("identifier");
          if (BLOCKED_IDENTIFIERS.has(prop.value)) {
            throw new Error(`Access to '${prop.value}' is not allowed`);
          }
          // Check if this is a method call: property followed by (
          if (this.current().type === "punctuation" && this.current().value === "(") {
            if (!ALLOWED_METHODS.has(prop.value)) {
              throw new Error(`Method '${prop.value}' is not allowed. Allowed: ${[...ALLOWED_METHODS].join(", ")}`);
            }
            this.advance(); // skip (
            const args: ASTNode[] = [];
            if (!(this.current().type === "punctuation" && this.current().value === ")")) {
              args.push(this.parseTernary());
              while (this.current().type === "punctuation" && this.current().value === ",") {
                this.advance();
                args.push(this.parseTernary());
              }
            }
            this.expect("punctuation", ")");
            node = {
              type: "call",
              callee: { type: "member", object: node, property: { type: "literal", value: prop.value }, computed: false },
              args,
            };
          } else {
            // Check "length" as a property, not a method
            node = { type: "member", object: node, property: { type: "literal", value: prop.value }, computed: false };
          }
        } else if (this.current().type === "punctuation" && this.current().value === "[") {
          this.advance();
          const property = this.parseTernary();
          this.expect("punctuation", "]");
          node = { type: "member", object: node, property, computed: true };
        } else if (this.current().type === "punctuation" && this.current().value === "(") {
          // Standalone function call — only allowed on identifiers that are in ALLOWED_METHODS
          // (handled in evaluator — parse it but evaluator will reject non-method calls)
          this.advance();
          const args: ASTNode[] = [];
          if (!(this.current().type === "punctuation" && this.current().value === ")")) {
            args.push(this.parseTernary());
            while (this.current().type === "punctuation" && this.current().value === ",") {
              this.advance();
              args.push(this.parseTernary());
            }
          }
          this.expect("punctuation", ")");
          node = { type: "call", callee: node, args };
        } else {
          break;
        }
      }
      return node;
    }

    // Primary expressions
    private parsePrimary(): ASTNode {
      const tok = this.current();

      // Number literal
      if (tok.type === "number") {
        this.advance();
        return { type: "literal", value: parseFloat(tok.value) };
      }

      // String literal
      if (tok.type === "string") {
        this.advance();
        return { type: "literal", value: tok.value };
      }

      // Keyword literals
      if (tok.type === "identifier") {
        if (tok.value === "true") {
          this.advance();
          return { type: "literal", value: true };
        }
        if (tok.value === "false") {
          this.advance();
          return { type: "literal", value: false };
        }
        if (tok.value === "null") {
          this.advance();
          return { type: "literal", value: null };
        }
        if (tok.value === "undefined") {
          this.advance();
          return { type: "literal", value: null }; // treat undefined as null
        }
        // Block dangerous identifiers at root level
        if (BLOCKED_IDENTIFIERS.has(tok.value)) {
          throw new Error(`Access to '${tok.value}' is not allowed`);
        }
        this.advance();
        return { type: "identifier", name: tok.value };
      }

      // Parenthesized expression
      if (tok.type === "punctuation" && tok.value === "(") {
        this.advance();
        const expr = this.parseTernary();
        this.expect("punctuation", ")");
        return expr;
      }

      // Object literal
      if (tok.type === "punctuation" && tok.value === "{") {
        return this.parseObjectLiteral();
      }

      // Array literal
      if (tok.type === "punctuation" && tok.value === "[") {
        return this.parseArrayLiteral();
      }

      throw new Error(`Unexpected token '${tok.value}' at position ${tok.pos}`);
    }

    private parseObjectLiteral(): ASTNode {
      this.advance(); // skip {
      const properties: { key: string; value: ASTNode }[] = [];
      while (!(this.current().type === "punctuation" && this.current().value === "}")) {
        // Key can be identifier or string
        let key: string;
        if (this.current().type === "identifier") {
          key = this.advance().value;
        } else if (this.current().type === "string") {
          key = this.advance().value;
        } else {
          throw new Error(`Expected property name at position ${this.current().pos}`);
        }
        this.expect("punctuation", ":");
        const value = this.parseTernary();
        properties.push({ key, value });
        if (this.current().type === "punctuation" && this.current().value === ",") {
          this.advance();
        }
      }
      this.expect("punctuation", "}");
      return { type: "object", properties };
    }

    private parseArrayLiteral(): ASTNode {
      this.advance(); // skip [
      const elements: ASTNode[] = [];
      while (!(this.current().type === "punctuation" && this.current().value === "]")) {
        elements.push(this.parseTernary());
        if (this.current().type === "punctuation" && this.current().value === ",") {
          this.advance();
        }
      }
      this.expect("punctuation", "]");
      return { type: "array", elements };
    }
  }

  // ---- Evaluator ----

  class Evaluator {
    private steps = 0;

    constructor(private scope: ExpressionScope) {}

    eval(node: ASTNode): unknown {
      this.steps++;
      if (this.steps > MAX_EVAL_STEPS) {
        throw new Error(`Expression evaluation exceeded maximum of ${MAX_EVAL_STEPS} steps`);
      }

      switch (node.type) {
        case "literal":
          return node.value;

        case "identifier":
          return this.resolveIdentifier(node.name);

        case "member":
          return this.evalMember(node);

        case "unary":
          return this.evalUnary(node);

        case "binary":
          return this.evalBinary(node);

        case "ternary": {
          const test = this.eval(node.test);
          return test ? this.eval(node.consequent) : this.eval(node.alternate);
        }

        case "call":
          return this.evalCall(node);

        case "object": {
          const obj: Record<string, unknown> = {};
          for (const prop of node.properties) {
            obj[prop.key] = this.eval(prop.value);
          }
          return obj;
        }

        case "array":
          return node.elements.map((el) => this.eval(el));

        default:
          throw new Error(`Unknown AST node type: ${(node as ASTNode).type}`);
      }
    }

    private resolveIdentifier(name: string): unknown {
      if (name === "input") return this.scope.input;
      if (name === "context") return this.scope.context;
      throw new Error(`Unknown variable '${name}'. Available: input, context`);
    }

    private evalMember(node: ASTNode & { type: "member" }): unknown {
      const obj = this.eval(node.object);
      if (obj === null || obj === undefined) {
        throw new Error(`Cannot read property '${this.getMemberKey(node)}' of ${obj}`);
      }

      let key: string | number;
      if (node.computed) {
        const computed = this.eval(node.property);
        key = typeof computed === "number" ? computed : String(computed);
      } else {
        key = (node.property as ASTNode & { type: "literal" }).value as string;
      }

      if (typeof key === "string" && BLOCKED_IDENTIFIERS.has(key)) {
        throw new Error(`Access to '${key}' is not allowed`);
      }

      if (key === "length" && (typeof obj === "string" || Array.isArray(obj))) {
        return obj.length;
      }

      if (typeof obj === "object" && obj !== null) {
        return (obj as Record<string, unknown>)[key as string];
      }

      return undefined;
    }

    private getMemberKey(node: ASTNode & { type: "member" }): string {
      if (!node.computed && node.property.type === "literal") {
        return String(node.property.value);
      }
      return "[computed]";
    }

    private evalUnary(node: ASTNode & { type: "unary" }): unknown {
      const operand = this.eval(node.operand);
      switch (node.operator) {
        case "!":
          return !operand;
        case "-":
          return -(operand as number);
        case "typeof":
          return typeof operand;
        default:
          throw new Error(`Unknown unary operator: ${node.operator}`);
      }
    }

    private evalBinary(node: ASTNode & { type: "binary" }): unknown {
      // Short-circuit for logical operators
      if (node.operator === "&&") {
        const left = this.eval(node.left);
        return left ? this.eval(node.right) : left;
      }
      if (node.operator === "||") {
        const left = this.eval(node.left);
        return left ? left : this.eval(node.right);
      }
      if (node.operator === "??") {
        const left = this.eval(node.left);
        return left !== null && left !== undefined ? left : this.eval(node.right);
      }

      const left = this.eval(node.left);
      const right = this.eval(node.right);

      switch (node.operator) {
        case "+":
          return (left as number) + (right as number);
        case "-":
          return (left as number) - (right as number);
        case "*":
          return (left as number) * (right as number);
        case "/": {
          if ((right as number) === 0) throw new Error("Division by zero");
          return (left as number) / (right as number);
        }
        case "%":
          return (left as number) % (right as number);
        case ">":
          return (left as number) > (right as number);
        case "<":
          return (left as number) < (right as number);
        case ">=":
          return (left as number) >= (right as number);
        case "<=":
          return (left as number) <= (right as number);
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        default:
          throw new Error(`Unknown binary operator: ${node.operator}`);
      }
    }

    private evalCall(node: ASTNode & { type: "call" }): unknown {
      // Only member calls are allowed (e.g., input.name.startsWith("Dr"))
      if (node.callee.type !== "member") {
        throw new Error("Only method calls on objects are allowed (e.g., input.name.startsWith(...))");
      }

      const memberNode = node.callee;
      const obj = this.eval(memberNode.object);
      const methodName = (memberNode.property as ASTNode & { type: "literal" }).value as string;

      if (!ALLOWED_METHODS.has(methodName)) {
        throw new Error(`Method '${methodName}' is not allowed`);
      }

      const args = node.args.map((a) => this.eval(a));

      // String methods
      if (typeof obj === "string") {
        switch (methodName) {
          case "contains":
          case "includes":
            return obj.includes(args[0] as string);
          case "startsWith":
            return obj.startsWith(args[0] as string);
          case "endsWith":
            return obj.endsWith(args[0] as string);
          case "substring":
            return obj.substring(args[0] as number, args[1] as number | undefined);
          case "slice":
            return obj.slice(args[0] as number, args[1] as number | undefined);
          case "indexOf":
            return obj.indexOf(args[0] as string);
          case "toLowerCase":
            return obj.toLowerCase();
          case "toUpperCase":
            return obj.toUpperCase();
          case "trim":
            return obj.trim();
          case "split":
            return obj.split(args[0] as string);
          case "toString":
            return obj.toString();
          default:
            throw new Error(`Method '${methodName}' is not supported on strings`);
        }
      }

      // Array methods
      if (Array.isArray(obj)) {
        switch (methodName) {
          case "join":
            return obj.join(args[0] as string);
          case "includes":
          case "contains":
            return obj.includes(args[0]);
          case "indexOf":
            return obj.indexOf(args[0]);
          case "slice":
            return obj.slice(args[0] as number, args[1] as number | undefined);
          case "map":
          case "filter":
            // map/filter with expressions are not supported in v1 — need callback syntax
            throw new Error(`Array ${methodName}() with callbacks is not supported in expressions`);
          case "toString":
            return obj.toString();
          default:
            throw new Error(`Method '${methodName}' is not supported on arrays`);
        }
      }

      // Object methods
      if (typeof obj === "object" && obj !== null) {
        switch (methodName) {
          case "keys":
            return Object.keys(obj as Record<string, unknown>);
          case "values":
            return Object.values(obj as Record<string, unknown>);
          case "entries":
            return Object.entries(obj as Record<string, unknown>);
          case "toString":
            return JSON.stringify(obj);
          default:
            throw new Error(`Method '${methodName}' is not supported on objects`);
        }
      }

      throw new Error(`Cannot call '${methodName}' on ${typeof obj}`);
    }
  }

  // ---- Public API ----

  /**
   * Parse and evaluate an expression string against the given scope.
   * Throws nothing -- always returns an ExpressionResult.
   */
  export function evaluate(expression: string, scope: ExpressionScope): ExpressionResult {
    try {
      if (expression.length > MAX_EXPRESSION_LENGTH) {
        return {
          success: false,
          value: undefined,
          error: `Expression exceeds maximum length of ${MAX_EXPRESSION_LENGTH} characters`,
        };
      }

      const lexer = new Lexer(expression);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const ast = parser.parse();
      const evaluator = new Evaluator(scope);
      const value = evaluator.eval(ast);

      return { success: true, value };
    } catch (error) {
      return {
        success: false,
        value: undefined,
        error: error instanceof Error ? error.message : "Unknown evaluation error",
      };
    }
  }

  /**
   * Validate an expression string without executing it.
   * Returns parse errors if the expression is malformed.
   */
  export function validateExpression(expression: string): {
    valid: boolean;
    error?: string;
  } {
    try {
      if (expression.length > MAX_EXPRESSION_LENGTH) {
        return {
          valid: false,
          error: `Expression exceeds maximum length of ${MAX_EXPRESSION_LENGTH} characters`,
        };
      }

      const lexer = new Lexer(expression);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      parser.parse(); // Only parse, don't evaluate

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Unknown parse error",
      };
    }
  }
  ```

- [ ] Run: `pnpm --filter @gnana/core typecheck && pnpm --filter @gnana/core build`
- [ ] Commit: `feat(core): add safe expression evaluator with recursive descent parser`

---

### Task 5: Enhance Transform Node

> **Depends on:** Task 1 (expression evaluator)
> Can run in parallel with Task 1 if both steps are done by the same agent in sequence.

**Files:**

- Modify: `packages/core/src/dag-executor.ts`

**Steps:**

- [ ] In `packages/core/src/dag-executor.ts`, add this import at the top:

  ```typescript
  import { evaluate, type ExpressionScope } from "./expression-evaluator.js";
  ```

- [ ] Replace the `executeTransformNode` function (lines 509-519) with:

  ```typescript
  async function executeTransformNode(
    node: DAGNode,
    inputs: unknown,
    ctx: DAGContext,
    results: NodeResults,
  ): Promise<unknown> {
    const expression = (node.data.expression as string) ?? "";
    if (!expression) return inputs;

    const scope: ExpressionScope = {
      input: inputs,
      context: {
        triggerData: ctx.triggerData,
        results: Object.fromEntries(results),
        runId: ctx.runId,
      },
    };

    const result = evaluate(expression, scope);

    if (!result.success) {
      await ctx.events.emit("run:log", {
        runId: ctx.runId,
        nodeId: node.id,
        type: "expression_error",
        error: result.error,
        expression,
      });
      return inputs;
    }

    return result.value;
  }
  ```

- [ ] Update the `case "transform"` call site in both `executeDAG` (the main BFS loop) and `resumeDAG` to pass `ctx` and `results`:

  In `executeDAG` (around line 177), change:
  ```typescript
  case "transform": {
    result = await executeTransformNode(node, inputs, ctx, results);
    break;
  }
  ```

  In `resumeDAG` (around line 333), change:
  ```typescript
  case "transform":
    result = await executeTransformNode(node, inputs, ctx, results);
    break;
  ```

- [ ] Run: `pnpm --filter @gnana/core typecheck && pnpm --filter @gnana/core build`

> **Do not commit yet** — this commit will be combined with Task 6 (merge node) below.

---

### Task 6: Enhance Merge Node (Strategies)

**Files:**

- Modify: `packages/core/src/dag-executor.ts`

**Steps:**

- [ ] Replace the `case "merge"` handler in `executeDAG` (around line 190-193) with a call to a new `executeMergeNode` function:

  ```typescript
  case "merge": {
    result = await executeMergeNode(node, inputs, ctx);
    break;
  }
  ```

- [ ] Also update the `case "merge"` in `resumeDAG` (around line 341-342):

  ```typescript
  case "merge":
    result = await executeMergeNode(node, inputs, ctx);
    break;
  ```

- [ ] Add the `executeMergeNode` function and the `deepMerge` helper at the bottom of `dag-executor.ts`, alongside the other node executors:

  ```typescript
  async function executeMergeNode(
    node: DAGNode,
    inputs: unknown,
    ctx: DAGContext,
  ): Promise<unknown> {
    const strategy = (node.data.strategy as string) ?? "object";

    await ctx.events.emit("run:log", {
      runId: ctx.runId,
      nodeId: node.id,
      type: "merge_strategy",
      strategy,
    });

    switch (strategy) {
      case "concat": {
        if (typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)) {
          const values = Object.values(inputs as Record<string, unknown>);
          return values.flatMap((v) => (Array.isArray(v) ? v : [v]));
        }
        return Array.isArray(inputs) ? inputs : [inputs];
      }

      case "first": {
        if (typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)) {
          const values = Object.values(inputs as Record<string, unknown>);
          return values.find((v) => v !== undefined && v !== null) ?? null;
        }
        return inputs;
      }

      case "deepMerge": {
        if (typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)) {
          const values = Object.values(inputs as Record<string, unknown>);
          return values.reduce<unknown>((acc, val) => {
            if (typeof acc === "object" && acc !== null && typeof val === "object" && val !== null) {
              return deepMerge(acc as Record<string, unknown>, val as Record<string, unknown>);
            }
            return val ?? acc;
          }, {});
        }
        return inputs;
      }

      case "object":
      default: {
        return inputs;
      }
    }
  }

  function deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      const targetVal = target[key];
      const sourceVal = source[key];
      if (
        typeof targetVal === "object" &&
        targetVal !== null &&
        !Array.isArray(targetVal) &&
        typeof sourceVal === "object" &&
        sourceVal !== null &&
        !Array.isArray(sourceVal)
      ) {
        result[key] = deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>,
        );
      } else {
        result[key] = sourceVal;
      }
    }
    return result;
  }
  ```

- [ ] Run: `pnpm --filter @gnana/core typecheck && pnpm --filter @gnana/core build`
- [ ] Commit: `feat(core): enhance transform and merge nodes with safe evaluator and strategies`

---

## Wave 2 — Depends on Task 1 (Expression Evaluator)

### Task 2: Enhance Condition Node

**Files:**

- Modify: `packages/core/src/dag-executor.ts`

**Steps:**

- [ ] Ensure the import of `evaluate` and `ExpressionScope` from `"./expression-evaluator.js"` is present at the top of `dag-executor.ts` (added in Task 5).

- [ ] Replace the `executeConditionNode` function (lines 491-507) with:

  ```typescript
  async function executeConditionNode(
    node: DAGNode,
    inputs: unknown,
    ctx: DAGContext,
    results: NodeResults,
  ): Promise<{ value: boolean; data: unknown }> {
    const expression = (node.data.expression as string) ?? "true";

    const scope: ExpressionScope = {
      input: inputs,
      context: {
        triggerData: ctx.triggerData,
        results: Object.fromEntries(results),
        runId: ctx.runId,
      },
    };

    const result = evaluate(expression, scope);

    if (!result.success) {
      await ctx.events.emit("run:log", {
        runId: ctx.runId,
        nodeId: node.id,
        type: "expression_error",
        error: result.error,
        expression,
      });
      // Safe default: false on error (do NOT execute the true branch)
      return { value: false, data: inputs };
    }

    return { value: !!result.value, data: inputs };
  }
  ```

- [ ] Update the condition node call sites in both `executeDAG` and `resumeDAG` to pass `ctx` and `results`:

  In `executeDAG` (around line 153), change:
  ```typescript
  case "condition": {
    result = await executeConditionNode(node, inputs, ctx, results);
    // rest of branching logic stays the same...
  ```

  In `resumeDAG` (around line 312), change:
  ```typescript
  case "condition": {
    result = await executeConditionNode(node, inputs, ctx, results);
    // rest of branching logic stays the same...
  ```

- [ ] Run: `pnpm --filter @gnana/core typecheck && pnpm --filter @gnana/core build`
- [ ] Commit: `feat(core): replace unsafe new Function() in condition node with expression evaluator`

---

### Task 3: Enhance Loop Node

**Files:**

- Modify: `packages/core/src/dag-executor.ts`

**Steps:**

- [ ] Add a `topologicalSortNodes` helper function to `dag-executor.ts` (used by the subgraph executor):

  ```typescript
  function topologicalSortNodes(
    nodes: DAGNode[],
    edges: DAGEdge[],
  ): string[] {
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const node of nodes) {
      adjacency.set(node.id, []);
      inDegree.set(node.id, 0);
    }

    for (const edge of edges) {
      adjacency.get(edge.source)?.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const next of adjacency.get(id) ?? []) {
        const newDeg = (inDegree.get(next) ?? 1) - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) queue.push(next);
      }
    }

    return order;
  }
  ```

- [ ] Add the `executeNodeByType` dispatcher function. This extracts the switch statement into a reusable function so `executeSubgraph` can call it:

  ```typescript
  async function executeNodeByType(
    node: DAGNode,
    inputs: unknown,
    ctx: DAGContext,
    results: NodeResults,
    pipeline: DAGPipeline,
  ): Promise<unknown> {
    switch (node.type) {
      case "llm":
        return executeLLMNode(node, inputs, ctx);
      case "tool":
        return executeToolNode(node, inputs, ctx);
      case "condition": {
        const condResult = await executeConditionNode(node, inputs, ctx, results);
        return condResult;
      }
      case "transform":
        return executeTransformNode(node, inputs, ctx, results);
      case "merge":
        return executeMergeNode(node, inputs, ctx);
      case "loop":
        return executeLoopNode(node, inputs, ctx, results, pipeline);
      case "parallel":
        return executeParallelNode(node, inputs, ctx, results, pipeline);
      case "output":
        return inputs;
      case "humanGate":
        // In subgraph context, auto-approve (loops/parallel cannot pause)
        return { approved: true };
      default:
        return inputs;
    }
  }
  ```

- [ ] Add the `executeSubgraph` helper function:

  ```typescript
  async function executeSubgraph(
    nodeIds: string[],
    initialInput: unknown,
    ctx: DAGContext,
    parentResults: NodeResults,
    pipeline: DAGPipeline,
  ): Promise<NodeResults> {
    const subResults: NodeResults = new Map();
    const subNodes = pipeline.nodes.filter((n) => nodeIds.includes(n.id));
    const subEdges = pipeline.edges.filter(
      (e) => nodeIds.includes(e.source) && nodeIds.includes(e.target),
    );

    const order = topologicalSortNodes(subNodes, subEdges);

    for (const nodeId of order) {
      const node = subNodes.find((n) => n.id === nodeId);
      if (!node) continue;

      // Gather inputs: from subgraph results first, fall back to parent results, then initialInput
      const inputEdges = subEdges.filter((e) => e.target === nodeId);
      let nodeInput: unknown;
      if (inputEdges.length === 0) {
        nodeInput = initialInput;
      } else if (inputEdges.length === 1) {
        nodeInput =
          subResults.get(inputEdges[0]!.source) ??
          parentResults.get(inputEdges[0]!.source) ??
          initialInput;
      } else {
        const combined: Record<string, unknown> = {};
        for (const edge of inputEdges) {
          const key = edge.label ?? edge.source;
          combined[key] = subResults.get(edge.source) ?? parentResults.get(edge.source);
        }
        nodeInput = combined;
      }

      await ctx.events.emit("run:node_started", {
        runId: ctx.runId,
        nodeId,
        type: node.type,
      });

      const result = await executeNodeByType(node, nodeInput, ctx, parentResults, pipeline);
      subResults.set(nodeId, result);

      await ctx.events.emit("run:node_completed", { runId: ctx.runId, nodeId, result });
      await ctx.store.updateNodeResult(ctx.runId, nodeId, result);
    }

    return subResults;
  }
  ```

- [ ] Replace the `executeLoopNode` function (lines 521-551) with:

  ```typescript
  async function executeLoopNode(
    node: DAGNode,
    inputs: unknown,
    ctx: DAGContext,
    results: NodeResults,
    pipeline: DAGPipeline,
  ): Promise<unknown> {
    const maxIterations = (node.data.maxIterations as number) ?? 10;
    const untilCondition = (node.data.untilCondition as string) ?? (node.data.condition as string) ?? "false";
    const bodyNodeIds = (node.data.bodyNodeIds as string[]) ?? [];

    let current = inputs;

    for (let i = 0; i < maxIterations; i++) {
      await ctx.events.emit("run:log", {
        runId: ctx.runId,
        nodeId: node.id,
        type: "loop_iteration",
        iteration: i + 1,
        maxIterations,
      });

      // Execute body nodes in topological order
      if (bodyNodeIds.length > 0) {
        const bodyResults = await executeSubgraph(bodyNodeIds, current, ctx, results, pipeline);
        // The last body node's result becomes the new "current"
        const lastBodyNodeId = bodyNodeIds[bodyNodeIds.length - 1]!;
        current = bodyResults.get(lastBodyNodeId) ?? current;

        // Merge body results back into the main results map with iteration suffix
        for (const [nodeId, result] of bodyResults) {
          results.set(`${nodeId}__iter_${i}`, result);
        }
      }

      // Evaluate until condition using the safe expression evaluator
      const scope: ExpressionScope = {
        input: current,
        context: {
          triggerData: ctx.triggerData,
          results: Object.fromEntries(results),
          iteration: i,
          runId: ctx.runId,
        },
      };

      const condResult = evaluate(untilCondition, scope);
      if (condResult.success && !!condResult.value) {
        await ctx.events.emit("run:log", {
          runId: ctx.runId,
          nodeId: node.id,
          type: "loop_condition_met",
          iteration: i + 1,
        });
        break;
      }
    }

    return current;
  }
  ```

- [ ] Update the `case "loop"` call sites in both `executeDAG` and `resumeDAG` to pass `results` and `pipeline`:

  In `executeDAG`:
  ```typescript
  case "loop": {
    result = await executeLoopNode(node, inputs, ctx, results, pipeline);
    break;
  }
  ```

  In `resumeDAG`:
  ```typescript
  case "loop":
    result = await executeLoopNode(node, inputs, ctx, results, pipeline);
    break;
  ```

- [ ] Run: `pnpm --filter @gnana/core typecheck && pnpm --filter @gnana/core build`
- [ ] Commit: `feat(core): enhance loop node with body execution and safe expression evaluator`

---

### Task 4: Enhance Parallel Node (Promise.all)

**Files:**

- Modify: `packages/core/src/dag-executor.ts`

**Steps:**

- [ ] Add the `identifyBranch` helper function:

  ```typescript
  /**
   * Starting from `startNodeId`, walk forward through the pipeline
   * collecting node IDs until we hit a merge node or circle back
   * to the parallel node.
   */
  function identifyBranch(
    startNodeId: string,
    parallelNodeId: string,
    pipeline: DAGPipeline,
  ): string[] {
    const branchNodeIds: string[] = [];
    const visited = new Set<string>();
    const queue = [startNodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current) || current === parallelNodeId) continue;
      visited.add(current);

      const node = pipeline.nodes.find((n) => n.id === current);
      if (!node) continue;

      // Stop at merge nodes — they belong to the parent flow, not the branch
      if (node.type === "merge") continue;

      branchNodeIds.push(current);

      // Enqueue downstream nodes
      const downstream = pipeline.edges
        .filter((e) => e.source === current)
        .map((e) => e.target);
      queue.push(...downstream);
    }

    return branchNodeIds;
  }
  ```

- [ ] Add the `branchTimeout` helper function:

  ```typescript
  function branchTimeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }
  ```

- [ ] Add the `executeParallelNode` function:

  ```typescript
  async function executeParallelNode(
    node: DAGNode,
    inputs: unknown,
    ctx: DAGContext,
    results: NodeResults,
    pipeline: DAGPipeline,
  ): Promise<unknown> {
    const onBranchError = (node.data.onBranchError as string) ?? "fail-all";
    const branchTimeoutMs = (node.data.branchTimeoutMs as number) ?? 0;

    // Identify branches from downstream edges
    const adjacency = buildAdjacencyList(pipeline);
    const downstream = adjacency.get(node.id) ?? [];

    if (downstream.length === 0) return inputs;

    await ctx.events.emit("run:log", {
      runId: ctx.runId,
      nodeId: node.id,
      type: "parallel_start",
      branchCount: downstream.length,
    });

    // Each downstream edge is a separate branch
    const branchPromises = downstream.map(async (edge) => {
      const branchNodeIds = identifyBranch(edge.target, node.id, pipeline);
      // Deep copy input for isolation between branches
      const branchInput = structuredClone(inputs);

      const branchExecution = executeSubgraph(
        branchNodeIds,
        branchInput,
        ctx,
        results,
        pipeline,
      );

      if (branchTimeoutMs > 0) {
        return Promise.race([
          branchExecution,
          branchTimeout(branchTimeoutMs, `Branch starting at ${edge.target} timed out`),
        ]);
      }

      return branchExecution;
    });

    let branchResults: NodeResults[];

    if (onBranchError === "fail-all") {
      branchResults = await Promise.all(branchPromises);
    } else {
      const settled = await Promise.allSettled(branchPromises);
      branchResults = [];
      for (const settledResult of settled) {
        if (settledResult.status === "fulfilled") {
          branchResults.push(settledResult.value);
        } else {
          await ctx.events.emit("run:log", {
            runId: ctx.runId,
            nodeId: node.id,
            type: "branch_error",
            error: settledResult.reason instanceof Error
              ? settledResult.reason.message
              : "Unknown branch error",
          });
          branchResults.push(new Map());
        }
      }
    }

    // Merge all branch results back into the main results map
    for (const br of branchResults) {
      for (const [nodeId, brResult] of br) {
        results.set(nodeId, brResult);
      }
    }

    // Return the combined branch outputs as an array
    const branchOutputs = branchResults.map((br) => {
      const entries = [...br.entries()];
      const lastEntry = entries[entries.length - 1];
      return lastEntry ? lastEntry[1] : undefined;
    });

    return branchOutputs;
  }
  ```

- [ ] Replace the `case "parallel"` handler in `executeDAG` (around line 185-189) with:

  ```typescript
  case "parallel": {
    result = await executeParallelNode(node, inputs, ctx, results, pipeline);
    break;
  }
  ```

  And in `resumeDAG` (around line 341):
  ```typescript
  case "parallel":
    result = await executeParallelNode(node, inputs, ctx, results, pipeline);
    break;
  ```

- [ ] Run: `pnpm --filter @gnana/core typecheck && pnpm --filter @gnana/core build`
- [ ] Commit: `feat(core): enhance parallel node with true concurrent execution via Promise.all`

---

## Wave 3 — Depends on Tasks 1-6

### Task 7: Dry-Run Executor

**Files:**

- Create: `packages/core/src/dag-dry-run.ts`
- Modify: `packages/core/src/index.ts`

**Steps:**

- [ ] Create `packages/core/src/dag-dry-run.ts`:

  ```typescript
  import type { DAGPipeline, DAGNode, DAGEdge } from "./dag-executor.js";
  import { evaluate, validateExpression, type ExpressionScope } from "./expression-evaluator.js";

  // ---- Public Types ----

  export interface DryRunOptions {
    pipeline: DAGPipeline;
    triggerData?: unknown;
    /** For condition nodes: default branch when no expression or expression errors. */
    defaultConditionBranch?: "true" | "false";
    /** Maximum loop iterations during dry-run (lower than real to keep preview fast). */
    maxLoopIterations?: number;
    /** Mock data overrides per node ID. */
    mockData?: Record<string, unknown>;
  }

  export interface DryRunNodeResult {
    nodeId: string;
    nodeType: DAGNode["type"];
    /** Order in which this node would execute (0-indexed). */
    executionOrder: number;
    /** The mock input this node would receive. */
    mockInput: unknown;
    /** The mock output this node would produce. */
    mockOutput: unknown;
    /** For condition nodes: which branch was taken. */
    branchTaken?: "true" | "false";
    /** For loop nodes: how many iterations would run. */
    iterationCount?: number;
    /** For parallel nodes: branch count. */
    branchCount?: number;
    /** Duration estimate in ms (0 for instant nodes, rough estimate for LLM/tool). */
    estimatedDurationMs: number;
    /** Estimated token usage for LLM nodes. */
    estimatedTokens?: { input: number; output: number };
    /** Warnings (e.g., expression parse error, missing config). */
    warnings: string[];
  }

  export interface DryRunResult {
    /** Whether the dry-run completed without fatal errors. */
    success: boolean;
    /** Ordered list of nodes that would execute. */
    executionPath: DryRunNodeResult[];
    /** Node IDs that would NOT execute (skipped branches, unreachable nodes). */
    skippedNodeIds: string[];
    /** Total estimated token usage across all LLM nodes. */
    totalEstimatedTokens: { input: number; output: number };
    /** Pipeline-level validation warnings. */
    validationWarnings: string[];
    /** Fatal error if the dry-run could not complete. */
    error?: string;
  }

  // ---- Internal helpers ----

  function buildAdjacencyList(
    pipeline: DAGPipeline,
  ): Map<string, { target: string; sourceHandle?: string }[]> {
    const adj = new Map<string, { target: string; sourceHandle?: string }[]>();
    for (const edge of pipeline.edges) {
      if (!adj.has(edge.source)) adj.set(edge.source, []);
      adj.get(edge.source)!.push({
        target: edge.target,
        sourceHandle: edge.sourceHandle,
      });
    }
    return adj;
  }

  function buildInDegree(pipeline: DAGPipeline): Map<string, number> {
    const inDeg = new Map<string, number>();
    for (const node of pipeline.nodes) inDeg.set(node.id, 0);
    for (const edge of pipeline.edges) {
      inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
    }
    return inDeg;
  }

  function gatherMockInputs(
    nodeId: string,
    pipeline: DAGPipeline,
    results: Map<string, unknown>,
  ): unknown {
    const inputEdges = pipeline.edges.filter((e) => e.target === nodeId);
    if (inputEdges.length === 0) return {};
    if (inputEdges.length === 1) return results.get(inputEdges[0]!.source);
    const combined: Record<string, unknown> = {};
    for (const edge of inputEdges) {
      const key = edge.label ?? edge.source;
      combined[key] = results.get(edge.source);
    }
    return combined;
  }

  function identifyBranch(
    startNodeId: string,
    parallelNodeId: string,
    pipeline: DAGPipeline,
  ): string[] {
    const branchNodeIds: string[] = [];
    const visited = new Set<string>();
    const queue = [startNodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current) || current === parallelNodeId) continue;
      visited.add(current);
      const node = pipeline.nodes.find((n) => n.id === current);
      if (!node || node.type === "merge") continue;
      branchNodeIds.push(current);
      const downstream = pipeline.edges
        .filter((e) => e.source === current)
        .map((e) => e.target);
      queue.push(...downstream);
    }
    return branchNodeIds;
  }

  function validatePipeline(pipeline: DAGPipeline): string[] {
    const warnings: string[] = [];
    const triggers = pipeline.nodes.filter((n) => n.type === "trigger");
    if (triggers.length === 0) {
      warnings.push("Pipeline has no trigger node");
    }
    const outputs = pipeline.nodes.filter((n) => n.type === "output");
    if (outputs.length === 0) {
      warnings.push("Pipeline has no output node");
    }
    // Check for orphan nodes (no incoming or outgoing edges and not a trigger)
    for (const node of pipeline.nodes) {
      if (node.type === "trigger") continue;
      const hasIncoming = pipeline.edges.some((e) => e.target === node.id);
      const hasOutgoing = pipeline.edges.some((e) => e.source === node.id);
      if (!hasIncoming && !hasOutgoing) {
        warnings.push(`Node '${node.id}' (${node.type}) is disconnected from the pipeline`);
      }
    }
    // Validate expressions in condition/transform/loop nodes
    for (const node of pipeline.nodes) {
      if (node.type === "condition" || node.type === "transform") {
        const expr = (node.data.expression as string) ?? "";
        if (expr && expr !== "true" && expr !== "false" && expr !== "if ...") {
          const validation = validateExpression(expr);
          if (!validation.valid) {
            warnings.push(`Node '${node.id}' has invalid expression: ${validation.error}`);
          }
        }
      }
      if (node.type === "loop") {
        const expr = (node.data.untilCondition as string) ?? (node.data.condition as string) ?? "";
        if (expr && expr !== "false") {
          const validation = validateExpression(expr);
          if (!validation.valid) {
            warnings.push(`Node '${node.id}' has invalid loop condition: ${validation.error}`);
          }
        }
      }
    }
    return warnings;
  }

  // ---- Mock Node Executors ----

  function mockTriggerNode(triggerData: unknown): { mockOutput: unknown; warnings: string[] } {
    return { mockOutput: triggerData ?? {}, warnings: [] };
  }

  function mockLLMNode(
    node: DAGNode,
    mockInput: unknown,
  ): {
    mockOutput: unknown;
    estimatedDurationMs: number;
    estimatedTokens: { input: number; output: number };
    warnings: string[];
  } {
    const systemPrompt = (node.data.systemPrompt as string) ?? "";
    const model = (node.data.model as string) ?? "unknown";
    const maxTokens = (node.data.maxTokens as number) ?? 4096;
    const warnings: string[] = [];

    if (!systemPrompt) {
      warnings.push("LLM node has no system prompt configured");
    }

    const inputStr = JSON.stringify(mockInput);
    const estimatedInputTokens = Math.ceil(inputStr.length / 4);
    const estimatedOutputTokens = Math.ceil(maxTokens / 4);

    return {
      mockOutput: {
        response: `[Mock LLM response for: ${systemPrompt.slice(0, 80)}]`,
        model,
      },
      estimatedDurationMs: 2000, // rough estimate for LLM call
      estimatedTokens: { input: estimatedInputTokens, output: estimatedOutputTokens },
      warnings,
    };
  }

  function mockToolNode(
    node: DAGNode,
    mockData: Record<string, unknown> | undefined,
  ): { mockOutput: unknown; estimatedDurationMs: number; warnings: string[] } {
    const toolName = (node.data.toolName as string) ?? (node.data.name as string) ?? "unknown";
    const warnings: string[] = [];

    if (toolName === "unknown") {
      warnings.push("Tool node has no tool name configured");
    }

    const output = mockData?.[node.id] ?? {
      result: `[Mock tool result for: ${toolName}]`,
      tool: toolName,
    };

    return { mockOutput: output, estimatedDurationMs: 500, warnings };
  }

  function mockConditionNode(
    node: DAGNode,
    mockInput: unknown,
    results: Map<string, unknown>,
    triggerData: unknown,
    runId: string,
    defaultBranch: "true" | "false",
  ): { branchTaken: "true" | "false"; mockOutput: unknown; warnings: string[] } {
    const expression = (node.data.expression as string) ?? "";
    const warnings: string[] = [];

    if (!expression || expression === "if ...") {
      warnings.push("Condition node has no expression; using default branch");
      return { branchTaken: defaultBranch, mockOutput: mockInput, warnings };
    }

    const scope: ExpressionScope = {
      input: mockInput,
      context: {
        triggerData,
        results: Object.fromEntries(results),
        runId,
      },
    };

    const evalResult = evaluate(expression, scope);

    if (!evalResult.success) {
      warnings.push(`Expression evaluation failed: ${evalResult.error}; using default branch`);
      return { branchTaken: defaultBranch, mockOutput: mockInput, warnings };
    }

    const branchTaken = evalResult.value ? "true" : "false";
    return { branchTaken, mockOutput: mockInput, warnings };
  }

  function mockTransformNode(
    node: DAGNode,
    mockInput: unknown,
    results: Map<string, unknown>,
    triggerData: unknown,
    runId: string,
  ): { mockOutput: unknown; warnings: string[] } {
    const expression = (node.data.expression as string) ?? "";
    const warnings: string[] = [];

    if (!expression || expression === "Map data") {
      return { mockOutput: mockInput, warnings };
    }

    const scope: ExpressionScope = {
      input: mockInput,
      context: {
        triggerData,
        results: Object.fromEntries(results),
        runId,
      },
    };

    const evalResult = evaluate(expression, scope);

    if (!evalResult.success) {
      warnings.push(`Transform expression failed: ${evalResult.error}; passing input through`);
      return { mockOutput: mockInput, warnings };
    }

    return { mockOutput: evalResult.value, warnings };
  }

  function mockMergeNode(
    node: DAGNode,
    mockInput: unknown,
  ): { mockOutput: unknown; warnings: string[] } {
    const strategy = (node.data.strategy as string) ?? "object";

    switch (strategy) {
      case "concat": {
        if (typeof mockInput === "object" && mockInput !== null && !Array.isArray(mockInput)) {
          const values = Object.values(mockInput as Record<string, unknown>);
          return { mockOutput: values.flatMap((v) => (Array.isArray(v) ? v : [v])), warnings: [] };
        }
        return { mockOutput: Array.isArray(mockInput) ? mockInput : [mockInput], warnings: [] };
      }
      case "first": {
        if (typeof mockInput === "object" && mockInput !== null && !Array.isArray(mockInput)) {
          const values = Object.values(mockInput as Record<string, unknown>);
          return { mockOutput: values.find((v) => v !== undefined && v !== null) ?? null, warnings: [] };
        }
        return { mockOutput: mockInput, warnings: [] };
      }
      case "deepMerge":
      case "object":
      default:
        return { mockOutput: mockInput, warnings: [] };
    }
  }

  // ---- Main Dry-Run Executor ----

  /**
   * Execute a dry-run simulation of the pipeline.
   * No LLM calls, no tool executions, no side effects.
   */
  export function executeDryRun(options: DryRunOptions): DryRunResult {
    const {
      pipeline,
      triggerData = {},
      defaultConditionBranch = "true",
      maxLoopIterations = 2,
      mockData,
    } = options;

    const executionPath: DryRunNodeResult[] = [];
    const mockResults = new Map<string, unknown>();
    const visitedNodeIds = new Set<string>();
    const validationWarnings = validatePipeline(pipeline);
    let executionOrder = 0;

    // Use a synthetic runId for expression evaluation context
    const runId = "dry-run";

    try {
      // Find trigger nodes
      const triggerNodes = pipeline.nodes.filter((n) => n.type === "trigger");
      if (triggerNodes.length === 0) {
        return {
          success: false,
          executionPath: [],
          skippedNodeIds: pipeline.nodes.map((n) => n.id),
          totalEstimatedTokens: { input: 0, output: 0 },
          validationWarnings,
          error: "Pipeline has no trigger node",
        };
      }

      const adjacency = buildAdjacencyList(pipeline);
      const inDegree = buildInDegree(pipeline);

      // Initialize with trigger nodes
      const queue: string[] = [];
      const pending = new Map<string, number>();

      for (const trigger of triggerNodes) {
        const { mockOutput, warnings } = mockTriggerNode(triggerData);
        mockResults.set(trigger.id, mockOutput);
        visitedNodeIds.add(trigger.id);
        executionPath.push({
          nodeId: trigger.id,
          nodeType: "trigger",
          executionOrder: executionOrder++,
          mockInput: triggerData,
          mockOutput,
          estimatedDurationMs: 0,
          warnings,
        });

        // Enqueue downstream
        const downstream = adjacency.get(trigger.id) ?? [];
        for (const next of downstream) {
          if (!pending.has(next.target)) {
            pending.set(next.target, inDegree.get(next.target) ?? 1);
          }
          pending.set(next.target, (pending.get(next.target) ?? 1) - 1);
          if (pending.get(next.target) === 0) {
            queue.push(next.target);
          }
        }
      }

      // BFS through the DAG
      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (visitedNodeIds.has(nodeId)) continue;

        const node = pipeline.nodes.find((n) => n.id === nodeId);
        if (!node) continue;

        const mockInput = gatherMockInputs(nodeId, pipeline, mockResults);
        let mockOutput: unknown = mockInput;
        let estimatedDurationMs = 0;
        let estimatedTokens: { input: number; output: number } | undefined;
        let branchTaken: "true" | "false" | undefined;
        let iterationCount: number | undefined;
        let branchCount: number | undefined;
        const warnings: string[] = [];

        switch (node.type) {
          case "llm": {
            const llmResult = mockLLMNode(node, mockInput);
            mockOutput = llmResult.mockOutput;
            estimatedDurationMs = llmResult.estimatedDurationMs;
            estimatedTokens = llmResult.estimatedTokens;
            warnings.push(...llmResult.warnings);
            break;
          }

          case "tool": {
            const toolResult = mockToolNode(node, mockData);
            mockOutput = toolResult.mockOutput;
            estimatedDurationMs = toolResult.estimatedDurationMs;
            warnings.push(...toolResult.warnings);
            break;
          }

          case "humanGate": {
            mockOutput = { approved: true, autoApproved: true };
            break;
          }

          case "condition": {
            const condResult = mockConditionNode(
              node,
              mockInput,
              mockResults,
              triggerData,
              runId,
              defaultConditionBranch,
            );
            mockOutput = condResult.mockOutput;
            branchTaken = condResult.branchTaken;
            warnings.push(...condResult.warnings);

            // Only enqueue the taken branch
            mockResults.set(nodeId, mockOutput);
            visitedNodeIds.add(nodeId);
            executionPath.push({
              nodeId,
              nodeType: node.type,
              executionOrder: executionOrder++,
              mockInput,
              mockOutput,
              branchTaken,
              estimatedDurationMs: 0,
              warnings,
            });

            const condDownstream = (adjacency.get(nodeId) ?? []).filter(
              (e) => !e.sourceHandle || e.sourceHandle === branchTaken,
            );
            for (const next of condDownstream) {
              if (!visitedNodeIds.has(next.target)) {
                queue.push(next.target);
              }
            }
            continue; // skip default downstream processing
          }

          case "transform": {
            const transformResult = mockTransformNode(node, mockInput, mockResults, triggerData, runId);
            mockOutput = transformResult.mockOutput;
            warnings.push(...transformResult.warnings);
            break;
          }

          case "merge": {
            const mergeResult = mockMergeNode(node, mockInput);
            mockOutput = mergeResult.mockOutput;
            warnings.push(...mergeResult.warnings);
            break;
          }

          case "loop": {
            const maxIter = Math.min(
              maxLoopIterations,
              (node.data.maxIterations as number) ?? 10,
            );
            iterationCount = maxIter;
            mockOutput = mockInput;

            // Try evaluating untilCondition to see if it terminates early
            const untilCond = (node.data.untilCondition as string) ?? (node.data.condition as string) ?? "false";
            for (let i = 0; i < maxIter; i++) {
              const scope: ExpressionScope = {
                input: mockOutput,
                context: {
                  triggerData,
                  results: Object.fromEntries(mockResults),
                  iteration: i,
                  runId,
                },
              };
              const condResult = evaluate(untilCond, scope);
              if (condResult.success && !!condResult.value) {
                iterationCount = i + 1;
                break;
              }
            }
            break;
          }

          case "parallel": {
            const downstream = adjacency.get(nodeId) ?? [];
            branchCount = downstream.length;

            // "Execute" each branch mockly
            for (const edge of downstream) {
              const branchNodeIds = identifyBranch(edge.target, nodeId, pipeline);
              // Mock each branch node
              for (const branchNodeId of branchNodeIds) {
                if (visitedNodeIds.has(branchNodeId)) continue;
                const branchNode = pipeline.nodes.find((n) => n.id === branchNodeId);
                if (!branchNode) continue;

                const branchInput = gatherMockInputs(branchNodeId, pipeline, mockResults) ?? mockInput;
                // Simple mock for branch nodes
                let branchOutput: unknown = branchInput;
                const branchWarnings: string[] = [];
                let branchEstimatedTokens: { input: number; output: number } | undefined;
                let branchDuration = 0;

                if (branchNode.type === "llm") {
                  const llmRes = mockLLMNode(branchNode, branchInput);
                  branchOutput = llmRes.mockOutput;
                  branchEstimatedTokens = llmRes.estimatedTokens;
                  branchDuration = llmRes.estimatedDurationMs;
                  branchWarnings.push(...llmRes.warnings);
                } else if (branchNode.type === "tool") {
                  const toolRes = mockToolNode(branchNode, mockData);
                  branchOutput = toolRes.mockOutput;
                  branchDuration = toolRes.estimatedDurationMs;
                  branchWarnings.push(...toolRes.warnings);
                } else if (branchNode.type === "transform") {
                  const trResult = mockTransformNode(branchNode, branchInput, mockResults, triggerData, runId);
                  branchOutput = trResult.mockOutput;
                  branchWarnings.push(...trResult.warnings);
                }

                mockResults.set(branchNodeId, branchOutput);
                visitedNodeIds.add(branchNodeId);
                executionPath.push({
                  nodeId: branchNodeId,
                  nodeType: branchNode.type,
                  executionOrder: executionOrder++,
                  mockInput: branchInput,
                  mockOutput: branchOutput,
                  estimatedDurationMs: branchDuration,
                  estimatedTokens: branchEstimatedTokens,
                  warnings: branchWarnings,
                });
              }
            }

            mockOutput = mockInput;
            break;
          }

          case "output": {
            mockOutput = mockInput;
            break;
          }

          default:
            mockOutput = mockInput;
        }

        mockResults.set(nodeId, mockOutput);
        visitedNodeIds.add(nodeId);
        executionPath.push({
          nodeId,
          nodeType: node.type,
          executionOrder: executionOrder++,
          mockInput,
          mockOutput,
          branchTaken,
          iterationCount,
          branchCount,
          estimatedDurationMs,
          estimatedTokens,
          warnings,
        });

        // Enqueue downstream (condition handles its own via continue above)
        const downstream = adjacency.get(nodeId) ?? [];
        for (const next of downstream) {
          if (!visitedNodeIds.has(next.target) && !queue.includes(next.target)) {
            const targetNode = pipeline.nodes.find((n) => n.id === next.target);
            if (targetNode?.type === "merge") {
              const inputEdges = pipeline.edges.filter((e) => e.target === next.target);
              const allReady = inputEdges.every((e) => visitedNodeIds.has(e.source));
              if (allReady) queue.push(next.target);
            } else {
              queue.push(next.target);
            }
          }
        }
      }

      // Compute skipped nodes
      const allNodeIds = pipeline.nodes.map((n) => n.id);
      const skippedNodeIds = allNodeIds.filter((id) => !visitedNodeIds.has(id));

      // Aggregate token estimates
      const totalEstimatedTokens = { input: 0, output: 0 };
      for (const nodeResult of executionPath) {
        if (nodeResult.estimatedTokens) {
          totalEstimatedTokens.input += nodeResult.estimatedTokens.input;
          totalEstimatedTokens.output += nodeResult.estimatedTokens.output;
        }
      }

      return {
        success: true,
        executionPath,
        skippedNodeIds,
        totalEstimatedTokens,
        validationWarnings,
      };
    } catch (error) {
      return {
        success: false,
        executionPath,
        skippedNodeIds: pipeline.nodes
          .map((n) => n.id)
          .filter((id) => !visitedNodeIds.has(id)),
        totalEstimatedTokens: { input: 0, output: 0 },
        validationWarnings,
        error: error instanceof Error ? error.message : "Unknown dry-run error",
      };
    }
  }
  ```

- [ ] Update `packages/core/src/index.ts` to export the new modules. Add these lines:

  ```typescript
  // Expression evaluator
  export { evaluate, validateExpression } from "./expression-evaluator.js";
  export type { ExpressionScope, ExpressionContext, ExpressionResult } from "./expression-evaluator.js";

  // Dry-run engine
  export { executeDryRun } from "./dag-dry-run.js";
  export type { DryRunOptions, DryRunResult, DryRunNodeResult } from "./dag-dry-run.js";
  ```

- [ ] Run: `pnpm --filter @gnana/core typecheck && pnpm --filter @gnana/core build`
- [ ] Commit: `feat(core): add dry-run executor with mock node handlers and execution path computation`

---

## Wave 4 — Depends on Task 7

### Task 8: Dry-Run API Endpoint

**Files:**

- Modify: `packages/server/src/validation/schemas.ts`
- Modify: `packages/server/src/routes/runs.ts`

**Steps:**

- [ ] Add the `dryRunSchema` to `packages/server/src/validation/schemas.ts`. Add this after the `createRunSchema` definition:

  ```typescript
  export const dryRunSchema = z.object({
    agentId: z.string().uuid("agentId must be a valid UUID"),
    triggerData: z.record(z.string(), z.unknown()).optional(),
    defaultConditionBranch: z.enum(["true", "false"]).optional(),
    maxLoopIterations: z.number().int().min(1).max(10).optional(),
    mockData: z.record(z.string(), z.unknown()).optional(),
  });
  ```

- [ ] In `packages/server/src/routes/runs.ts`, add the import for the dry-run schema. Update the import line:

  ```typescript
  import { createRunSchema, dryRunSchema } from "../validation/schemas.js";
  ```

- [ ] Add the import for `executeDryRun` and `agents` table. Update the existing imports:

  ```typescript
  import { eq, and, desc, sql, runs, runLogs, usageRecords, agents, type Database } from "@gnana/db";
  import type { EventBus, DAGPipeline } from "@gnana/core";
  import { executeDryRun } from "@gnana/core";
  ```

- [ ] Add the dry-run endpoint in `runRoutes`, **before** the `"/:id"` route (because Hono matches routes in order, and `/dry-run` must not be caught by `/:id`). Place it after the `POST /` route:

  ```typescript
  // Dry-run preview — editor+ (30 req/min, no run record created)
  app.post(
    "/dry-run",
    requireRole("editor"),
    rateLimit({ windowMs: 60_000, maxRequests: 30 }),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const body = await c.req.json();
      const parsed = dryRunSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Validation failed",
              details: parsed.error.flatten().fieldErrors,
            },
          },
          400,
        );
      }

      const data = parsed.data;

      // Fetch the agent's pipeline config
      const agent = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, data.agentId), eq(agents.workspaceId, workspaceId)));
      if (agent.length === 0) {
        return errorResponse(c, 404, "NOT_FOUND", "Agent not found");
      }

      const pipeline = agent[0]!.pipelineConfig as DAGPipeline;
      if (!pipeline?.nodes?.length) {
        return errorResponse(c, 400, "INVALID_PIPELINE", "Agent has no pipeline configured");
      }

      const result = executeDryRun({
        pipeline,
        triggerData: data.triggerData ?? {},
        defaultConditionBranch: data.defaultConditionBranch as "true" | "false" | undefined,
        maxLoopIterations: data.maxLoopIterations,
        mockData: data.mockData,
      });

      return c.json(result);
    },
  );
  ```

  **IMPORTANT**: This route must be placed **before** the `app.get("/:id", ...)` route. In the current `runs.ts`, insert it after the `app.post("/", ...)` block (line 119) and before the `app.post("/:id/approve", ...)` block (line 122).

- [ ] Run: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build`
- [ ] Commit: `feat(server): add POST /api/runs/dry-run endpoint for pipeline preview`

---

### Task 9: Dashboard Preview Button and Highlighting

**Files:**

- Create: `apps/dashboard/src/lib/canvas/use-dry-run.ts`
- Modify: `apps/dashboard/src/components/canvas/execution-toolbar.tsx`
- Modify: `apps/dashboard/src/components/canvas/pipeline-canvas.tsx`

**Steps:**

- [ ] Create `apps/dashboard/src/lib/canvas/use-dry-run.ts`:

  ```typescript
  import { useState, useCallback } from "react";

  interface DryRunNodeResult {
    nodeId: string;
    nodeType: string;
    executionOrder: number;
    mockInput: unknown;
    mockOutput: unknown;
    branchTaken?: "true" | "false";
    iterationCount?: number;
    branchCount?: number;
    estimatedDurationMs: number;
    estimatedTokens?: { input: number; output: number };
    warnings: string[];
  }

  export interface DryRunResult {
    success: boolean;
    executionPath: DryRunNodeResult[];
    skippedNodeIds: string[];
    totalEstimatedTokens: { input: number; output: number };
    validationWarnings: string[];
    error?: string;
  }

  interface UseDryRunOptions {
    agentId: string;
  }

  interface UseDryRunReturn {
    preview: DryRunResult | null;
    isLoading: boolean;
    error: string | null;
    runPreview: (triggerData?: Record<string, unknown>) => Promise<void>;
    clearPreview: () => void;
  }

  export function useDryRun({ agentId }: UseDryRunOptions): UseDryRunReturn {
    const [preview, setPreview] = useState<DryRunResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const runPreview = useCallback(
      async (triggerData?: Record<string, unknown>) => {
        setIsLoading(true);
        setError(null);

        try {
          const response = await fetch("/api/runs/dry-run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentId,
              triggerData: triggerData ?? {},
            }),
          });

          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message ?? "Dry run failed");
          }

          const result: DryRunResult = await response.json();
          setPreview(result);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Unknown error");
        } finally {
          setIsLoading(false);
        }
      },
      [agentId],
    );

    const clearPreview = useCallback(() => {
      setPreview(null);
      setError(null);
    }, []);

    return { preview, isLoading, error, runPreview, clearPreview };
  }
  ```

- [ ] Update `apps/dashboard/src/components/canvas/execution-toolbar.tsx` to add the Preview button, loading state, and result summary. Replace the entire file with:

  ```typescript
  "use client";

  import { Button } from "@/components/ui/button";
  import { Play, Pause, RotateCcw, SkipForward, Eye, Loader2, X } from "lucide-react";
  import type { DryRunResult } from "@/lib/canvas/use-dry-run";

  interface ExecutionToolbarProps {
    // Existing animation-based preview controls
    isRunning: boolean;
    isPaused: boolean;
    step: number;
    onStart: () => void;
    onPause: () => void;
    onResume: () => void;
    onReset: () => void;
    onStep: () => void;
    // New: server-side dry-run
    onPreview: () => void;
    isPreviewLoading: boolean;
    previewResult: DryRunResult | null;
    onClearPreview: () => void;
  }

  export function ExecutionToolbar({
    isRunning,
    isPaused,
    step,
    onStart,
    onPause,
    onResume,
    onReset,
    onStep,
    onPreview,
    isPreviewLoading,
    previewResult,
    onClearPreview,
  }: ExecutionToolbarProps) {
    return (
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-card border border-border rounded-lg shadow-lg px-2 py-1.5">
        {/* Dry-Run Preview Button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={onPreview}
          disabled={isPreviewLoading || isRunning}
          title="Preview execution path (dry run)"
        >
          {isPreviewLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          Preview
        </Button>

        {/* Preview result summary */}
        {previewResult && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
            <span>{previewResult.executionPath.length} nodes</span>
            <span className="text-border">|</span>
            <span>
              ~{previewResult.totalEstimatedTokens.input + previewResult.totalEstimatedTokens.output}{" "}
              tokens
            </span>
            {previewResult.validationWarnings.length > 0 && (
              <>
                <span className="text-border">|</span>
                <span className="text-yellow-500">
                  {previewResult.validationWarnings.length} warnings
                </span>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={onClearPreview}
              title="Clear preview"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Separator */}
        <div className="h-4 w-px bg-border mx-1" />

        {/* Existing play/pause/step/reset controls */}
        {!isRunning ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onStart}
            title="Start preview"
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
        ) : isPaused ? (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onResume} title="Resume">
            <Play className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPause} title="Pause">
            <Pause className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onStep}
          title="Step forward"
        >
          <SkipForward className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onReset}
          disabled={!isRunning && step === 0}
          title="Reset"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        {isRunning && <span className="text-xs text-muted-foreground px-1">Step {step + 1}</span>}
      </div>
    );
  }
  ```

- [ ] Update `apps/dashboard/src/components/canvas/pipeline-canvas.tsx`. Add the import for `useDryRun`:

  ```typescript
  import { useDryRun, type DryRunResult } from "@/lib/canvas/use-dry-run";
  ```

- [ ] In `PipelineCanvasInner`, add the `useDryRun` hook. Find the line with `const execPreview = useExecutionPreview(...)` (line 267) and add after it:

  ```typescript
  // Dry-run preview (server-side)
  // Note: agentId should be passed as a prop; for now use a placeholder that the parent provides
  const dryRun = useDryRun({ agentId: (nodes[0]?.data as Record<string, unknown>)?._agentId as string ?? "" });
  ```

  **Alternative (better):** Add `agentId` as an optional prop to `PipelineCanvasProps`:

  In the `PipelineCanvasProps` interface, add:
  ```typescript
  /** Agent ID for dry-run preview */
  agentId?: string;
  ```

  In the `PipelineCanvasInner` function signature, destructure `agentId`:
  ```typescript
  function PipelineCanvasInner({
    initialNodes,
    initialEdges,
    onChange,
    liveRun,
    onNodeSelect,
    agentId,
  }: PipelineCanvasProps) {
  ```

  Then use it:
  ```typescript
  const dryRun = useDryRun({ agentId: agentId ?? "" });
  ```

- [ ] Update the `ExecutionToolbar` usage to pass the new props. Find the `<ExecutionToolbar` block (around line 664) and update it to:

  ```typescript
  <ExecutionToolbar
    isRunning={execPreview.isRunning}
    isPaused={execPreview.isPaused}
    step={execPreview.step}
    onStart={execPreview.start}
    onPause={execPreview.pause}
    onResume={execPreview.resume}
    onReset={execPreview.reset}
    onStep={execPreview.stepForward}
    onPreview={() => dryRun.runPreview()}
    isPreviewLoading={dryRun.isLoading}
    previewResult={dryRun.preview}
    onClearPreview={dryRun.clearPreview}
  />
  ```

- [ ] Add dry-run visualization to the node styling. In the `useEffect` that updates node data with preview/live state (around line 299), add dry-run state. Add these variables inside the `nds.map((n) => { ... })` callback, after the existing `isLiveFailed` variable:

  ```typescript
  // Dry-run preview state (server-side)
  const isDryRunExecuted = dryRun.preview?.executionPath.some((p) => p.nodeId === n.id) ?? false;
  const isDryRunSkipped = dryRun.preview?.skippedNodeIds.includes(n.id) ?? false;
  const dryRunNodeResult = dryRun.preview?.executionPath.find((p) => p.nodeId === n.id);
  ```

  And add these to the returned data object:
  ```typescript
  data: {
    ...n.data,
    _errors: errors,
    _executing: isPreviewExecuting || isLiveExecuting,
    _executed: isPreviewExecuted || (isLiveCompleted ?? false),
    _failed: isLiveFailed ?? false,
    _dryRunExecuted: isDryRunExecuted,
    _dryRunSkipped: isDryRunSkipped,
    _dryRunBranch: dryRunNodeResult?.branchTaken,
    _dryRunWarnings: dryRunNodeResult?.warnings,
  },
  ```

  Add `dryRun.preview` to the dependency array of this `useEffect`.

- [ ] Add a `nodeClassName` callback for React Flow to apply visual highlighting. Add this before the `return` statement of `PipelineCanvasInner`:

  ```typescript
  const nodeClassName = useCallback(
    (node: Node) => {
      if (!dryRun.preview) return "";
      const inPath = dryRun.preview.executionPath.some((n) => n.nodeId === node.id);
      const isSkipped = dryRun.preview.skippedNodeIds.includes(node.id);
      if (inPath) return "ring-2 ring-blue-500/50";
      if (isSkipped) return "opacity-40";
      return "";
    },
    [dryRun.preview],
  );
  ```

- [ ] Pass `nodeClassName` to the `<ReactFlow>` component. Find the `<ReactFlow` tag and add the prop:

  ```typescript
  <ReactFlow
    nodes={nodes}
    // ... existing props
    nodeClassName={nodeClassName}
  ```

- [ ] Run: `pnpm --filter @gnana/dashboard typecheck && pnpm --filter @gnana/dashboard build`
- [ ] Commit: `feat(dashboard): add dry-run preview button with execution path highlighting`

---

## Final Verification

- [ ] Run full build from root: `pnpm build`
- [ ] Run full typecheck from root: `pnpm typecheck`
- [ ] Verify no `new Function()` or `eval()` calls remain in `dag-executor.ts`:
  ```bash
  grep -n "new Function\|eval(" packages/core/src/dag-executor.ts
  ```
  This should return no results.

---

## Files Summary

### Create

| File | Task | Description |
|---|---|---|
| `packages/core/src/expression-evaluator.ts` | Task 1 | Safe expression parser + evaluator (lexer, recursive-descent parser, tree-walking evaluator) |
| `packages/core/src/dag-dry-run.ts` | Task 7 | Dry-run engine (mock executors, execution path computation, token estimation) |
| `apps/dashboard/src/lib/canvas/use-dry-run.ts` | Task 9 | React hook for dry-run API calls and state |

### Modify

| File | Task(s) | Change |
|---|---|---|
| `packages/core/src/dag-executor.ts` | Tasks 2-6 | Replace `new Function()` calls with expression evaluator. Add `executeSubgraph`, `executeNodeByType`, `identifyBranch`, `branchTimeout` helpers. Enhance parallel node with `Promise.all`. Add merge node strategies. Pass `results` and `pipeline` to node executors that need them. |
| `packages/core/src/index.ts` | Task 7 | Export expression evaluator and dry-run types/functions |
| `packages/server/src/validation/schemas.ts` | Task 8 | Add `dryRunSchema` Zod schema |
| `packages/server/src/routes/runs.ts` | Task 8 | Add `POST /dry-run` endpoint |
| `apps/dashboard/src/components/canvas/execution-toolbar.tsx` | Task 9 | Add Preview button, loading state, result summary badge, clear button |
| `apps/dashboard/src/components/canvas/pipeline-canvas.tsx` | Task 9 | Accept `agentId` prop, wire `useDryRun` hook, apply execution path highlighting and skipped node dimming via `nodeClassName` |

---

## Dependency Graph

```
Task 1 (Expression Evaluator) ─┬─> Task 2 (Condition Node)
                                ├─> Task 3 (Loop Node) ──────> requires executeSubgraph
                                ├─> Task 4 (Parallel Node) ──> requires executeSubgraph, identifyBranch
                                ├─> Task 5 (Transform Node)
                                └─> Task 6 (Merge Node)
                                         │
Tasks 1-6 ─────────────────────────────> Task 7 (Dry-Run Executor)
                                                  │
Task 7 ──────────────────────────────────> Task 8 (Dry-Run API Endpoint)
                                                  │
Task 8 ──────────────────────────────────> Task 9 (Dashboard Preview UI)
```

**Estimated effort:** 3-4 days for a single developer.
