const LINES = ["w-11/12", "w-full", "w-10/12", "w-8/12", "w-9/12", "w-7/12", "w-5/12"];

export function NoteSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading note" className="flex flex-col gap-3">
      {LINES.map((width) => (
        <div key={width} className={`app-raised h-4 animate-pulse rounded ${width}`} />
      ))}
    </div>
  );
}
