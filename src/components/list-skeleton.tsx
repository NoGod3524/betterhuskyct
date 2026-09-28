/**
 * Grey blocks where a list of cards will be, while a page reads what it saved.
 *
 * The blocks are as tall as a closed card, so the cards arrive without moving
 * what is below them. `label` is what a screen reader hears in their place.
 */
export function ListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="mt-4 space-y-3" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton h-[76px]" aria-hidden />
      ))}
    </div>
  );
}
