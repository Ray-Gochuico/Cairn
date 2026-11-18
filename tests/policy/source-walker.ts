/**
 * Shared helpers for tests/policy/* source-scanning tests. Extracted from
 * recharts-animation-policy.test.ts (Wave 5) so the migration/IPC/clock
 * policies reuse one walker instead of three drifting copies.
 *
 * NOT a test file (no .test. suffix) — vitest ignores it; policy tests
 * import from it.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

export async function collectSourceFiles(
  dir: string,
  exts: string[] = ['.ts', '.tsx'],
): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectSourceFiles(full, exts)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

export function lineNumberOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) line += 1;
  }
  return line;
}

// Strip `//` line comments and `/* */` block comments while preserving line
// numbers (each removed char becomes a space, newlines preserved). This keeps
// regex match indices aligned with the original source so error messages
// still point at the right line. Without this, JSX comments like
// `// <JavascriptAnimate>` inside a multi-line <Bar ...> prop list would
// prematurely terminate the `[^>]*` match at the `>` in the comment.
export function stripComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    // Block comment
    if (ch === '/' && next === '*') {
      out.push('  ');
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out.push(source[i] === '\n' ? '\n' : ' ');
        i += 1;
      }
      if (i < n) {
        out.push('  ');
        i += 2;
      }
      continue;
    }
    // Line comment
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out.push(' ');
        i += 1;
      }
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Clock reads (v1.8.0 W4, C174). A syntax-tree walk, not a regex, so a clock
// read inside a string, a template's text or a comment is never seen, and a
// read is judged by the block it sits in rather than by the whole file.
// `typescript` is already a devDependency (no new package).
// ---------------------------------------------------------------------------

/** One flagged clock read: 1-based line and the read's own source text. */
export interface ClockRead {
  line: number;
  text: string;
}

const SUITE_CALLS: ReadonlySet<string> = new Set(['describe', 'suite']);
const TEST_CALLS: ReadonlySet<string> = new Set(['it', 'test']);
const HOOK_CALLS: ReadonlySet<string> = new Set(['beforeEach', 'beforeAll', 'afterEach', 'afterAll']);
const SETUP_HOOKS: ReadonlySet<string> = new Set(['beforeEach', 'beforeAll']);
const FAKE_CLOCK_METHODS: ReadonlySet<string> = new Set(['useFakeTimers', 'setSystemTime']);

function parseSource(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** A no-argument `new Date()` (or `new Date`) or a no-argument `Date.now()`. */
function isClockRead(node: ts.Node): boolean {
  if (ts.isNewExpression(node)) {
    return ts.isIdentifier(node.expression) && node.expression.text === 'Date'
      && (node.arguments === undefined || node.arguments.length === 0);
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const target = node.expression.expression;
    return ts.isIdentifier(target) && target.text === 'Date'
      && node.expression.name.text === 'now' && node.arguments.length === 0;
  }
  return false;
}

function readAt(sf: ts.SourceFile, node: ts.Node): ClockRead {
  return { line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: node.getText(sf) };
}

/** The root name of a call's callee: `describe(…)`, `it.each(rows)(…)` and `describe.skip(…)` → the first identifier. */
function calleeRoot(call: ts.CallExpression): string | null {
  let e: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e)) e = e.expression;
  return ts.isIdentifier(e) ? e.text : null;
}

type FnNode = ts.ArrowFunction | ts.FunctionExpression;

function isFnNode(node: ts.Node | undefined): node is FnNode {
  return node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

function unwrapParens(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

/**
 * Names of the functions in this file whose bodies install the fake clock
 * (`function pin() { vi.useFakeTimers(); … }`, `const pin = () => …`), so a
 * hook or test that calls one, or passes one as its callback, counts as
 * setting the clock.
 */
function fakeClockHelpers(sf: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body && hasDirectFakeCall(node.body)) {
      names.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && isFnNode(unwrapParens(node.initializer)) && hasDirectFakeCall(unwrapParens(node.initializer))) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

function isFakeClockCall(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && FAKE_CLOCK_METHODS.has(node.expression.name.text);
}

function hasDirectFakeCall(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (isFakeClockCall(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Does this node install the fake clock: a `vi.useFakeTimers()` / `vi.setSystemTime()` call, or a call to (or pass of) a same-file helper that does? */
function installsFakeClock(node: ts.Node, helpers: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (isFakeClockCall(n)) {
      found = true;
      return;
    }
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression) && helpers.has(n.expression.text)) {
        found = true;
        return;
      }
      if (n.arguments.some((a) => ts.isIdentifier(a) && helpers.has(a.text))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function statementsOf(fn: FnNode): readonly ts.Statement[] {
  return ts.isBlock(fn.body) ? fn.body.statements : [];
}

/** A `beforeEach`/`beforeAll` statement whose hook installs the fake clock. */
function isFakeSetupHook(stmt: ts.Statement, helpers: ReadonlySet<string>): boolean {
  if (!ts.isExpressionStatement(stmt) || !ts.isCallExpression(stmt.expression)) return false;
  const root = calleeRoot(stmt.expression);
  return root !== null && SETUP_HOOKS.has(root) && installsFakeClock(stmt.expression, helpers);
}

/** A statement that installs the fake clock as it runs (not inside a hook, test or suite). */
function isDirectFakeStatement(stmt: ts.Statement, helpers: ReadonlySet<string>): boolean {
  if (!ts.isExpressionStatement(stmt)) return false;
  const e = stmt.expression;
  if (ts.isCallExpression(e)) {
    const root = calleeRoot(e);
    if (root !== null && (SUITE_CALLS.has(root) || TEST_CALLS.has(root) || HOOK_CALLS.has(root))) return false;
  }
  return installsFakeClock(e, helpers);
}

/**
 * C174 (a): every no-argument `new Date()` / `Date.now()` in a TEST source
 * that no fake clock covers when it runs.
 *
 * - Inside an `it`/`test` callback or a hook: covered when the callback
 *   itself installs the fake clock, or a `beforeEach`/`beforeAll` in its
 *   describe chain (or at module level) does.
 * - In a function defined in a describe or at module scope (a helper):
 *   covered by that describe chain's (or the module's) setup hooks only.
 * - At collection time (a describe body or module body, outside any function,
 *   or an immediately invoked function there): it runs before every hook, so
 *   only a fake-clock call made directly in that body or an enclosing one
 *   covers it.
 * A same-file helper whose body installs the fake clock counts as installing it.
 */
export function uncoveredClockReads(source: string, fileName: string): ClockRead[] {
  const sf = parseSource(source, fileName);
  const helpers = fakeClockHelpers(sf);
  const out: ClockRead[] = [];

  const walk = (node: ts.Node, runCovered: boolean, collectCovered: boolean, atCollection: boolean): void => {
    if (isClockRead(node) && !(atCollection ? collectCovered : runCovered)) out.push(readAt(sf, node));

    if (ts.isCallExpression(node)) {
      const callee = unwrapParens(node.expression);
      // An immediately invoked function runs where it stands.
      if (isFnNode(callee)) {
        node.arguments.forEach((a) => walk(a, runCovered, collectCovered, atCollection));
        walk(callee.body, runCovered, collectCovered, atCollection);
        return;
      }
      const root = calleeRoot(node);
      const cbIndex = node.arguments.findIndex((a) => isFnNode(a));
      if (root !== null && cbIndex >= 0 && (SUITE_CALLS.has(root) || TEST_CALLS.has(root) || HOOK_CALLS.has(root))) {
        walk(node.expression, runCovered, collectCovered, atCollection);
        node.arguments.forEach((a, i) => {
          if (i !== cbIndex) walk(a, runCovered, collectCovered, atCollection);
        });
        const cb = node.arguments[cbIndex] as FnNode;
        if (SUITE_CALLS.has(root)) {
          const stmts = statementsOf(cb);
          const direct = stmts.some((s) => isDirectFakeStatement(s, helpers));
          const hooked = stmts.some((s) => isFakeSetupHook(s, helpers));
          walk(cb.body, runCovered || hooked || direct, collectCovered || direct, true);
        } else {
          walk(cb.body, runCovered || installsFakeClock(cb, helpers), collectCovered, false);
        }
        return;
      }
    }

    if (ts.isFunctionLike(node)) {
      ts.forEachChild(node, (child) => walk(child, runCovered, collectCovered, false));
      return;
    }
    ts.forEachChild(node, (child) => walk(child, runCovered, collectCovered, atCollection));
  };

  const top = sf.statements;
  const moduleDirect = top.some((s) => isDirectFakeStatement(s, helpers));
  const moduleHooked = top.some((s) => isFakeSetupHook(s, helpers));
  ts.forEachChild(sf, (child) => walk(child, moduleHooked || moduleDirect, moduleDirect, true));
  return out;
}
