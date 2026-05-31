/**
 * Renders the "top anchors" list used by Day- and Week-synthesis bodies.
 * Returns null on empty input so callers can pass it through `extras`
 * without branching.
 */
export interface TopAnchor {
  signal: string;
  takeaway: string;
}

export function TopAnchorsList({ anchors }: { anchors: TopAnchor[] }) {
  if (anchors.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {anchors.map((a, i) => (
        <li key={i} className="rounded-md bg-[var(--color-surface-soft)] p-2 text-xs">
          <div className="font-medium text-[var(--color-text)]">{a.signal}</div>
          <div className="text-[var(--color-text-muted)]">{a.takeaway}</div>
        </li>
      ))}
    </ul>
  );
}
