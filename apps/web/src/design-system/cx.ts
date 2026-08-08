/**
 * cx — join class names, dropping anything falsy.
 *
 * Exists because the template-literal alternative is quietly dangerous:
 *
 *   `ds-kpi__value${large ? ' ds-kpi__value--lg' : ''}`
 *
 * is correct only while that leading space survives. Lose it — to a stray edit,
 * a formatter, a careless merge — and the result is `ds-kpi__valueds-kpi__value--lg`:
 * a single class that matches no rule. Nothing errors, nothing fails a type
 * check, and the variant silently renders as though it were never applied. That
 * exact bug reached a commit in this codebase and survived two attempts to fix
 * it in place.
 *
 * With `cx` the separator is the function's job and cannot be lost.
 *
 * Deliberately tiny and dependency-free — the same shape as the `cx` helper in
 * Project-Cadence's UI package.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
