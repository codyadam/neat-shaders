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
import { SHADERS, type ShaderDefinition, type ShaderGroup } from "@/lib/shaders/registry";
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

/** Higher is a better match. 0 hides the shader. Name/id beat group and description. */
function scoreShaderMatch(shader: ShaderDefinition, raw: string): number {
  const query = raw.trim().toLowerCase();
  if (!query) return 1;
  const name = shader.name.toLowerCase();
  const id = shader.id.toLowerCase();
  const idWords = shader.id.replace(/-/g, " ").toLowerCase();
  const group = shader.group.toLowerCase();
  const desc = shader.description.toLowerCase();

  const fieldScore = (field: string): number => {
    if (field === query) return 100;
    if (field.startsWith(query)) return 90;
    if (field.split(/[\s/_-]+/).some((word) => word.startsWith(query))) return 80;
    if (field.includes(query)) return 60;
    return 0;
  };

  const nameScore = Math.max(fieldScore(name), fieldScore(id), fieldScore(idWords));
  if (nameScore) return nameScore;
  const groupScore = fieldScore(group);
  if (groupScore) return 40;
  if (fieldScore(desc)) return 15;
  return 0;
}

export function ShaderCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = SHADERS.find((s) => s.id === value) ?? SHADERS[0];
  const searching = query.trim().length > 0;
  const matches = searching
    ? SHADERS.map((shader) => ({ shader, score: scoreShaderMatch(shader, query) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.shader.name.localeCompare(b.shader.name))
        .map((row) => row.shader)
    : null;

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-8 w-full justify-between text-xs">
          <span className="truncate">{selected.name}</span>
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search shaders…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No shader found.</CommandEmpty>
            {matches ? (
              matches.length > 0 ? (
                <CommandGroup heading="Results">
                  {matches.map((shader) => (
                    <ShaderItem key={shader.id} shader={shader} selectedId={value} onPick={pick} />
                  ))}
                </CommandGroup>
              ) : null
            ) : (
              GROUP_ORDER.map((group) => {
                const items = SHADERS.filter((s) => s.group === group);
                if (items.length === 0) return null;
                return (
                  <CommandGroup key={group} heading={group}>
                    {items.map((shader) => (
                      <ShaderItem key={shader.id} shader={shader} selectedId={value} onPick={pick} />
                    ))}
                  </CommandGroup>
                );
              })
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ShaderItem({
  shader,
  selectedId,
  onPick,
}: {
  shader: ShaderDefinition;
  selectedId: string;
  onPick: (id: string) => void;
}) {
  return (
    <CommandItem value={shader.id} onSelect={() => onPick(shader.id)}>
      <Check className={cn("size-3.5", shader.id === selectedId ? "opacity-100" : "opacity-0")} />
      <span className="min-w-0 flex-1 truncate">{shader.name}</span>
    </CommandItem>
  );
}
