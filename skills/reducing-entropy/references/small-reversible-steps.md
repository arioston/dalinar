---
description: Make the change easy, then make the easy change. Restructure in small, behavior-preserving steps so each move is safe and reversible.
---

# Small Reversible Steps

## The Core Insight

> "Make the change easy, then make the easy change."

Never refactor and change behavior at the same time. First restructure the code so the desired change becomes obvious and safe, then make the change. Each step should preserve existing behavior — if something breaks, you know exactly which step caused it.

## Why This Matters

Large changes are risky because you can't tell which part introduced a bug. Small, behavior-preserving steps give you:

- **Confidence**: each step can be verified independently.
- **Reversibility**: if a step goes wrong, you undo just that step.
- **Clarity**: after restructuring, the right design often becomes obvious — the code tells you what to do next.

The alternative — rewriting a complex section in one shot — is gambling that your mental model is complete. It rarely is.

## The Two Phases

**Phase 1: Restructure** — change the code's shape without changing what it does. Move functions, extract variables, rename things, split phases. Every intermediate state should pass all tests.

**Phase 2: Change behavior** — now that the code is in the right shape, the actual feature or fix is often trivial. A one-line change where before it would have been a scattered 30-line edit.

The discipline is keeping these phases separate. The moment you start doing both at once, you lose the ability to verify each step.

## Verifying Behavior Is Preserved

Tests are the obvious safety net, but they verify indirectly. For critical refactors, you can verify directly:

- **Property-based tests**: generate random inputs, pass them to both the old and new version, assert identical outputs. This tests the refactoring invariant itself.
- **Parallel implementations**: keep both versions temporarily, assert they agree, then delete the old one.
- **Type-driven verification**: if you strengthen a type (e.g., `string` → `EmailAddress`), the compiler finds every call site that needs updating. The code won't compile until the change is complete.

## Practical Application

Before making a change, ask:
- Can I restructure first so the change becomes a one-liner?
- Is each step I'm planning behavior-preserving? Could I commit after each one?
- If this step breaks something, will I know immediately, or will the bug hide?

If you can't verify a step preserves behavior, make the step smaller.

**Small steps that preserve behavior compound into large transformations that stay safe.**

## External References

- [Refactoring](https://www.refactoring.com/) — Martin Fowler's catalog of behavior-preserving transformations
- [Refactoring Invariants](https://buttondown.com/hillelwayne/archive/refactoring-invariants/) — Hillel Wayne on formally verifying refactors
- [The Liskov Substitution Principle Does More Than You Think](https://buttondown.com/hillelwayne/archive/the-liskov-substitution-principle-does-more-than/) — Hillel Wayne on contract preservation across substitutions
- [TigerBeetle TIGER_STYLE](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — "Push ifs up and fors down" as structural refactoring
