export { cn } from "cn";

/** Default character budget for file / frame names shown in the UI. */
export const NAME_MAX_CHARS = 32;

/**
 * Shortens a name to `max` characters with a middle ellipsis, keeping the
 * extension (when there is one) and the start of the stem, which is usually
 * the most recognisable part of a file name.
 */
export function truncateName(name: string, max: number = NAME_MAX_CHARS): string {
  const chars = Array.from(name.trim());
  if (chars.length <= max) return chars.join("");

  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0 && name.length - dot <= 8;
  const ext = hasExt ? Array.from(name.slice(dot)) : [];
  const stem = hasExt ? Array.from(name.slice(0, dot)) : chars;

  const budget = Math.max(4, max - ext.length - 1);
  const head = Math.ceil(budget * 0.65);
  const tail = budget - head;
  return `${stem.slice(0, head).join("")}…${tail > 0 ? stem.slice(-tail).join("") : ""}${ext.join("")}`;
}
