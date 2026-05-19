import { useEffect, type ReactNode } from "react";

export function AppHeader({ title, right }: { title: string; right?: ReactNode }) {
  useEffect(() => { document.title = `${title} — GC`; }, [title]);
  return (
    <header className="bg-[var(--navy)] text-white safe-top sticky top-0 z-30 shadow-sm">
      <div className="px-4 h-14 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{title}</h1>
        {right}
      </div>
    </header>
  );
}
