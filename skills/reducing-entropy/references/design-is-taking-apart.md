---
description: Design is taking things apart, not adding features. Separate concerns, remove dependencies, compose simple pieces.
---

# Composition Over Construction

## The Core Insight

> "Design is about taking things apart."

Good design is not about adding features. It's about removing dependencies. It's about separating concerns so cleanly that each piece can be understood, tested, and changed independently.

## Taking Things Apart

When you see a complex system, the instinct is to understand how the pieces fit together. But the real skill is seeing how to *pull them apart*.

- What different concerns are mixed here?
- Which responsibilities could be separate?
- Where are we conflating different concepts?

Each separation reduces complexity. Each coupling increases it.

## Building from Simple Parts

Once you have simple, independent pieces:
- They compose freely
- They test trivially
- They change safely

Composition has a structural prerequisite: only unary functions compose cleanly. Multiple parameters break the pipeline. Every technique for handling multi-parameter functions — currying, partial application, composite data structures — is really about *decomposing* a function into composable pieces.

The same principle applies to control flow: expressions compose, statements don't. `const x = condition ? a : b` is one composable piece. `let x; if (...) { x = a } else { x = b }` is three entangled pieces — a declaration, a mutation, and a branch — that can't be passed into a pipeline.

## Structural Patterns

Concrete ways to take things apart:

- **Push ifs up, push fors down.** Centralize control flow in parent functions, keep leaf functions pure. The parent decides *what* to do; helpers decide *how*.
- **Centralize state manipulation.** Let the parent keep state in local variables, use helpers to compute what needs to change rather than applying changes directly.
- **Separate the "what" from the "when."** Don't react directly to external events. Let your program run at its own pace, batching work instead of context-switching on every trigger.

## The Anti-Pattern

The opposite of composition is the "god object" or "kitchen sink" — one thing that knows about everything, does everything, and can't be changed without breaking everything else.

Every helper method you add to a class is a small step toward the kitchen sink. Every layer of abstraction is a coupling waiting to cause pain.

## Practical Application

Before adding a method, wrapper, or abstraction:
- Does this *separate* concerns, or *combine* them?
- Am I making pieces more independent, or more coupled?
- Could I solve this with a function that takes data and returns data?
- Does this function take one argument? If not, can I restructure so it does?

**Separate, don't combine. Compose, don't construct.**

## External References

- [Simple Made Easy](https://www.infoq.com/presentations/Simple-Made-Easy/) — Rich Hickey on complecting vs composing
- [How to Compose Functions That Take Multiple Parameters](https://jrsinclair.com/articles/2024/how-to-compose-functions-that-take-multiple-parameters-epic-guide/) — James Sinclair on why only unary functions compose
- [Rethinking the JavaScript Ternary Operator](https://jrsinclair.com/articles/2021/rethinking-the-javascript-ternary-operator/) — James Sinclair on expressions vs statements
- [TigerBeetle TIGER_STYLE](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — "Push ifs up, fors down"; centralize control flow, keep leaves pure
- [Out of the Tar Pit](https://curtclifton.net/papers/MosesleyMarks06a.pdf) — Moseley & Marks on essential vs accidental complexity
- [A Philosophy of Software Design](https://www.amazon.com/dp/173210221X) — John Ousterhout on deep vs shallow modules
