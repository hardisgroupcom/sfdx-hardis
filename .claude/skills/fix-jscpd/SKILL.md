---
name: fix-jscpd
description: Decision framework for fixing jscpd (copy-paste detector) errors. Use when asked to fix jscpd issues, copy-paste errors, or COPYPASTE lint failures.
user-invocable: false
---

# Fixing jscpd / Copy-Paste Issues

When jscpd reports a clone, decide between **factorization** and **ignore comments** based on these criteria.

## Decision Criteria

### Factorize when
- The duplicate logic is semantically identical and would not diverge (same intent, same data shape).
- Extracting it produces a clean, named helper with a clear single responsibility.
- The helper is small (under ~15 lines) and self-contained.
- The duplication is within the same file or a closely related module.

Examples in this project: `buildPersonaCols(n)` in profiles-extract.ts, `formatLimitLine(limit)` in limits.ts.

### Ignore with `/* jscpd:ignore-start */` / `/* jscpd:ignore-end */` when
- The clones are in separate, unrelated command files (each command is a standalone unit).
- The structure is the same but the data shapes or intent diverge (e.g., different result fields in different audit commands).
- The duplication is unavoidable boilerplate (standard flags: `agent`, `debug`, `websocket`, `skipauth`).
- Extracting would add indirection with no real benefit (e.g., `buildInitialMarkdownLines` in different DocBuilder subclasses).

## Ignore Comment Placement

Place `/* jscpd:ignore-start */` on the line **before** the first duplicate line, and `/* jscpd:ignore-end */` on the line **after** the last duplicate line. Keep the comments on their own lines, indented to match the surrounding code.

```typescript
/* jscpd:ignore-start */
for (const catcher of catchers) {
  const results = await catchMatches(catcher, file, fileText, this);
  this.matchResults.push(...results);
}
/* jscpd:ignore-end */
```

## Factorization Pattern

Add a private (or private static) helper method to the enclosing class, or a module-level function if the logic is pure and stateless.

```typescript
private static formatLimitLine(limit: any): string {
  return `• ${limit.name}: *${limit.percentUsed}%* used (${limit.used}/${limit.max})`;
}
```

Then replace the duplicate `.map(...)` blocks with `.map(MyClass.formatLimitLine)`.

## Standard Flag Boilerplate

The `agent`, `debug`, `websocket`, and `skipauth` flags appear in every command. These are always intentional duplicates - wrap them with jscpd:ignore rather than abstracting.
