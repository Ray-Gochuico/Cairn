/**
 * Exhaustiveness guard for finite unions (e.g. an {@link AccountType} switch).
 *
 * Call it in the `default` branch of a switch once every union member has its
 * own case. TypeScript narrows the argument to `never` there, so when a new
 * member is later added to the union it stops being assignable to `never` and
 * the call becomes a compile error at that switch — surfacing the unhandled
 * case instead of letting it fall through silently. If somehow reached at
 * runtime (e.g. a value from outside the type system), it throws.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled value in exhaustive switch: ${String(value)}`);
}
