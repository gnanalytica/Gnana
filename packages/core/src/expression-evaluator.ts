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
    return this.tokens[this.pos] ?? { type: "eof" as const, value: "", pos: -1 };
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
export function evaluateExpression(expression: string, scope: ExpressionScope): ExpressionResult {
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
