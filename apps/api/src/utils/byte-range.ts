export type ByteRange =
  | { readonly kind: "whole" }
  | { readonly kind: "part"; readonly start: number; readonly end: number }
  | { readonly kind: "unsatisfiable" };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/u;
const WHOLE: ByteRange = { kind: "whole" };
const UNSATISFIABLE: ByteRange = { kind: "unsatisfiable" };

function suffix(length: number, size: number): ByteRange {
  if (length === 0 || size === 0) return UNSATISFIABLE;
  return { kind: "part", start: Math.max(0, size - length), end: size - 1 };
}

function fromStart(start: number, last: string, size: number): ByteRange {
  if (start >= size) return UNSATISFIABLE;
  const end = last === "" ? size - 1 : Math.min(size - 1, Number(last));
  return end < start ? WHOLE : { kind: "part", start, end };
}

export function parseByteRange(header: string | null, size: number): ByteRange {
  const match = header === null ? null : SINGLE_RANGE.exec(header.trim());
  if (match === null) return WHOLE;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return WHOLE;
  return first === "" ? suffix(Number(last), size) : fromStart(Number(first), last, size);
}
