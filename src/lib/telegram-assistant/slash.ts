/**
 * Slash-command parser (Phase 0.6 / 1.4). `/cmd rest…` → capability + args,
 * resolved against the caller-supplied capability set (the user's included
 * effective capabilities), so Settings → Assistant APIs exclusions apply.
 * v1 is positional: the remainder maps to the capability's first param.
 */
import { type Capability } from './registry';

export interface ParsedSlash<C extends Capability = Capability> {
  capability: C;
  args: Record<string, string>;
}

export function parseSlash<C extends Capability>(text: string, caps: C[]): ParsedSlash<C> | null {
  const m = text.trim().match(/^(\/[a-zA-Z]+)\s*(.*)$/);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const rest = m[2].trim();
  const capability = caps.find((c) => c.slashCommand === cmd);
  if (!capability) return null;
  const args: Record<string, string> = {};
  if (rest && capability.params[0]) args[capability.params[0].name] = rest;
  return { capability, args };
}
