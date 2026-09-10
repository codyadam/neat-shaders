"use client";

import { toast } from "sonner";
import { parseStack, serializeStack } from "@/lib/shaders/stack-clipboard";
import { getShader } from "@/lib/shaders/registry";
import { useStudio } from "@/lib/store";
import type { Frame } from "@/lib/types";

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand("copy");
  el.remove();
  if (!ok) throw new Error("Clipboard is unavailable.");
}

export async function copyFrameStack(frame: Frame): Promise<boolean> {
  try {
    await writeClipboard(serializeStack(frame.layers));
    const names = frame.layers.map((l) => getShader(l.shaderId).name).join(" → ");
    toast.success("Stack copied", {
      description: names || `${frame.layers.length} shader(s)`,
    });
    return true;
  } catch (err) {
    toast.error("Could not copy stack", {
      description: err instanceof Error ? err.message : undefined,
    });
    return false;
  }
}

export function applyStackText(frameId: string, text: string): boolean {
  const drafts = parseStack(text);
  if (!drafts) {
    toast.error("Clipboard is not a shader stack");
    return false;
  }
  const ok = useStudio.getState().applyStack(frameId, drafts);
  if (!ok) {
    toast.error("Could not apply stack");
    return false;
  }
  const names = drafts.map((d) => getShader(d.shaderId).name).join(" → ");
  toast.success("Stack pasted", { description: names });
  return true;
}

export async function pasteFrameStack(frameId: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.readText) {
      toast.error("Paste a copied stack with ⌘V / Ctrl+V");
      return false;
    }
    const text = await navigator.clipboard.readText();
    return applyStackText(frameId, text);
  } catch (err) {
    toast.error("Could not read clipboard", {
      description: err instanceof Error ? err.message : "Allow clipboard access, or paste with ⌘V / Ctrl+V.",
    });
    return false;
  }
}
