---
description: 100 functions on one data structure beats 10 functions on 10 structures. Keep data open and generic — fight encapsulated behavior, not type precision.
---

# Data Over Abstractions

## The Core Insight

> "It is better to have 100 functions operate on one data structure than 10 functions on 10 data structures."

Generic operations on open data beat specialized methods on encapsulated objects. The power is in the combinations, not the custom constructs.

## What This Actually Fights

The enemy is **behavior-heavy wrappers that lock data inside methods**, not precise data shapes.

A `SettingsManager` class with getters, setters, validation logic, and event hooks can only be processed by its own methods. A `Map<string, Setting>` can be filtered, merged, serialized, diffed, and composed with hundreds of existing functions.

Every custom class you create:
- Adds a concept to learn
- Requires its own operations
- Limits composition with other code
- Creates maintenance burden

## What This Does NOT Fight

Precise data types are still data. A `NonEmpty<T>` is no more a "custom abstraction" than an array — it's a more precise data shape that existing generic functions can operate on. Sum types like `Loading | Error | Display` are open data with tags, not encapsulated behavior.

The distinction: can generic functions still operate on it? A discriminated union can be pattern-matched, serialized, and composed. A `class RequestHandler` with private state cannot.

Clojure has `spec`. Haskell has ADTs. TypeScript has discriminated unions. All three traditions value data precision — they just reject locking data behind method interfaces.

## Practical Application

Before creating a new class or wrapper, ask:
- Could this be a map/record with well-known keys?
- Could this be a tagged union (sum type) instead of a class hierarchy?
- Am I adding methods because I need behavior, or just organizing data?
- Can existing generic functions (filter, map, merge) still operate on this?

If you just need data with a precise shape, use data structures — including refined types and tagged unions. Save classes for when you genuinely need encapsulated state with behavior that can't be a pure function.

**Open data composes. Encapsulated behavior isolates.**

## External References

- [The Value of Values](https://www.infoq.com/presentations/Value-Values/) — Rich Hickey on data vs objects
- [Algebraic Data Types: Things I Wish Someone Had Explained](https://jrsinclair.com/articles/2019/algebraic-data-types-what-i-wish-someone-had-explained-about-functional-programming/) — James Sinclair on sum/product types as data
- [Data-Oriented Design](https://www.dataorienteddesign.com/dodbook/) — Richard Fabian
- [CppCon 2014: Mike Acton "Data-Oriented Design"](https://www.youtube.com/watch?v=rX0ItVEVjHc) — Practical DOD in game engines
