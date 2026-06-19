import { useMemo } from "react";
import { Model, compute } from "@/engine/compute";
import { useStore } from "./store";

/**
 * Derive the full computed model from the current project. Memoized on the
 * cabinets + settings references so it only recomputes when they actually
 * change (every store mutation produces fresh references).
 */
export function useModel(): Model {
  const cabinets = useStore((s) => s.project.cabinets);
  const settings = useStore((s) => s.project.settings);
  return useMemo(() => compute(cabinets, settings), [cabinets, settings]);
}
