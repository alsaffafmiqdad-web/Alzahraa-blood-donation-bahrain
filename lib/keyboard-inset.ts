/** Height of the on-screen keyboard (or other bottom overlay) in px, from the visual viewport. 0 when under 80. */
export function keyboardInset(innerHeight: number, vvHeight: number, vvOffsetTop: number): number {
  const inset = Math.max(0, Math.round(innerHeight - vvHeight - vvOffsetTop));
  return inset < 80 ? 0 : inset;
}
