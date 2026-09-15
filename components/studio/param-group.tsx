"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ParamGroup({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (!title) {
    return <div className="space-y-4">{children}</div>;
  }
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 w-full justify-between px-2.5"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{title}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </Button>
      {open ? <div className="space-y-4">{children}</div> : null}
    </div>
  );
}
