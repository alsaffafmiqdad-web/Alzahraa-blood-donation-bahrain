/** True when an input just became complete and focus should move on. */
export function shouldAdvance(next: string, prev: string, max: number, caretAtEnd: boolean): boolean {
  return caretAtEnd && next.length === max && next !== prev;
}
