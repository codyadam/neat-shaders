"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SHADERS, type ShaderGroup } from "@/lib/shaders/registry";
import { cn } from "@/lib/utils";

const GROUP_ORDER: ShaderGroup[] = [
  "Painterly",
  "Stylized",
  "ASCII",
  "Blur",
  "Color",
  "Atmosphere",
  "Utility",
];

export function ShaderCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = SHADERS.find((s) => s.id === value) ?? SHADERS[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-8 w-full justify-between text-xs">
          <span className="truncate">{selected.name}</span>
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search shaders…" />
          <CommandList>
            <CommandEmpty>No shader found.</CommandEmpty>
            {GROUP_ORDER.map((group) => {
              const items = SHADERS.filter((s) => s.group === group);
              if (items.length === 0) return null;
              return (
                <CommandGroup key={group} heading={group}>
                  {items.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={`${s.name} ${s.group} ${s.id} ${s.description}`}
                      onSelect={() => {
                        onChange(s.id);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("size-3.5", s.id === value ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
