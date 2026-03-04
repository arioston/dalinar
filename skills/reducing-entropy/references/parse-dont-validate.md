---
description: Preserve information learned from checks in your types, don't just assert and discard — validation throws knowledge away, parsing encodes it.
---

# Parse, Don't Validate

## The Core Insight

A parser is a function that consumes less-structured input and produces more-structured output. Validation checks a condition and throws the knowledge away; parsing checks the same condition and *keeps* what it learned in the type system.

This is still data-oriented thinking — a `NonEmpty<T>` or a `ContactInfo` union is open data with a more precise shape, not a behavior-heavy wrapper.

## Why This Matters

When you validate, you force every downstream consumer to either re-check the same condition or trust a comment that says "already validated." Both paths breed bugs:

- **Redundant checks** clutter code and drift out of sync with the original validation.
- **"Impossible" branches** (`else { throw "should never happen" }`) are holes in your type system — they compile fine today and explode tomorrow when someone changes the upstream check.
- **Shotgun parsing** — scattering validation across processing logic — means invalid input may be partially acted on before the error is caught, leaving your system in an inconsistent state.

Parsing eliminates all three by stratifying your program into two phases: *parse* (where failure is expected) and *execute* (where the data is already known-good by construction).

Formally, this is strengthening the argument type — which is equivalent to *weakening the precondition*. A function that accepts `NonEmpty<T>` has fewer failure modes than one that accepts `T[]` and checks internally. Every caller benefits, and the compiler enforces the contract across time.

## Names Are Not Type Safety

Not all "type safety" is equal. There is a critical distinction between:

- **Intrinsic safety (constructive modeling):** The type's *structure* makes illegal values impossible. `NonEmpty a = a :| [a]` literally cannot be empty — there is no representation for it. Downstream code needs no impossible branches because the compiler proves exhaustiveness.
- **Extrinsic safety (named wrappers):** `newtype EmailAddress = EmailAddress Text` is just a name. The safety depends entirely on trusting the module that wraps and unwraps it. Downstream code still pattern-matches against the underlying type and still needs `error "impossible"` cases.

Named wrappers are validation wearing a hat. They check a condition and then *forget the proof*, encoding it only as a convention. Prefer constructive types whose *shape* is the proof.

## Making Illegal States Unrepresentable

The practical technique: model the actual valid states as a union, not optional fields.

Instead of `{ email: Option, postal: Option }` (which permits the illegal state of both being `None`), use:

```
type ContactInfo =
  | EmailOnly of EmailContactInfo
  | PostOnly of PostalContactInfo
  | EmailAndPost of EmailContactInfo * PostalContactInfo
```

Now the compiler forces you to handle exactly the three valid cases. The fourth case (no contact info at all) is structurally impossible. Any change to the business rules changes the type, which breaks every call site that needs updating — at compile time, not in production.

## Practical Application

- **When you write a check that returns nothing useful** (`void`, `()`, `undefined`), ask: "What did I just learn, and how can I return a type that proves it?"
- **When you see `if (x !== null)` repeated** across callers, push the check to the boundary and return a narrower type that can't be null.
- **When you add a boolean flag** to a record to track "has been validated," replace it with a distinct type that can only be constructed through the validation path.
- **When you have two optional fields where at least one must be present**, replace them with a sum type that models the valid combinations.
- **When choosing data structures**, pick ones that make illegal states unrepresentable — a `Map` instead of a list of key-value pairs if duplicates are invalid, a tagged union instead of a string + runtime check.
- **When wrapping a value in a named type**, ask: does the *structure* prevent invalid values, or am I just giving it a name? If it's just a name, it's validation, not parsing.
- **Push the burden of proof upward**: parse at the boundary of your system, before any data is acted upon, and let precise types flow inward.

## Three Tiers of Safety

When you need to enforce an invariant, reach for the strongest tool that's practical:

1. **Constructive types** (strongest) — the type's structure makes invalid values unrepresentable. No impossible branches, compiler-enforced exhaustiveness. Prefer this when the type system can express it.
2. **Opaque wrappers with smart constructors** — a named type that hides its constructor behind a parsing function. Weaker — you trust the module, not the compiler — but practical when constructive modeling is impractical. Keep the trusted surface area small.
3. **Dense runtime assertions** (fallback) — assert pre/postconditions at every boundary, pair assertions so the same property is checked from two code paths. This isn't shotgun parsing; it's disciplined defense in depth. Use when neither types nor wrappers can carry the proof.

## External References

- [Parse, Don't Validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) — Alexis King
- [Names Are Not Type Safety](https://lexi-lambda.github.io/blog/2020/11/01/names-are-not-type-safety/) — Alexis King on intrinsic vs extrinsic safety
- [Making Illegal States Unrepresentable](https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/) — Scott Wlaschin on modeling valid states as unions
- [Type Safety Back and Forth](https://www.parsonsmatt.org/2017/10/11/type_safety_back_and_forth.html) — Matt Parsons
- [Algebraic Data Types: Things I Wish Someone Had Explained](https://jrsinclair.com/articles/2019/algebraic-data-types-what-i-wish-someone-had-explained-about-functional-programming/) — James Sinclair on sum/product types as the mechanism
- [The Liskov Substitution Principle Does More Than You Think](https://buttondown.com/hillelwayne/archive/the-liskov-substitution-principle-does-more-than/) — Hillel Wayne on pre/postcondition contracts
- [TigerBeetle TIGER_STYLE](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — Assertion-based alternative when types aren't enough
- [The Seven Turrets of Babel](http://langsec.org/papers/langsec-cwes-secdev2016.pdf) — LangSec on shotgun parsing
- [Ghosts of Departed Proofs](https://kataskeue.com/gdp.pdf) — Matt Noonan
