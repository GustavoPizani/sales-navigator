import { useState } from "react";
import { format, parse, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths, startOfYear, endOfYear } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Check } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

const PRESETS = [
  { label: "Hoje", fn: (t: Date): DateRange => ({ from: t, to: t }) },
  { label: "Esta semana", fn: (t: Date): DateRange => ({ from: startOfWeek(t, { weekStartsOn: 1 }), to: endOfWeek(t, { weekStartsOn: 1 }) }) },
  { label: "Este mês", fn: (t: Date): DateRange => ({ from: startOfMonth(t), to: t }) },
  { label: "Mês anterior", fn: (t: Date): DateRange => { const lm = subMonths(t, 1); return { from: startOfMonth(lm), to: endOfMonth(lm) }; } },
  { label: "Este ano", fn: (t: Date): DateRange => ({ from: startOfYear(t), to: endOfYear(t) }) },
];

function isoToDate(iso: string) {
  return parse(iso, "yyyy-MM-dd", new Date());
}

function dateToIso(d: Date) {
  return format(d, "yyyy-MM-dd");
}

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onApply: (start: string, end: string) => void;
  className?: string;
  /** Com onClear, o período pode ficar vazio (startDate/endDate ""): mostra "Todo o período". */
  onClear?: () => void;
}

export function DateRangePicker({ startDate, endDate, onApply, className, onClear }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const hasRange = !!startDate && !!endDate;
  const current = (): DateRange | undefined =>
    hasRange ? { from: isoToDate(startDate), to: isoToDate(endDate) } : undefined;
  const [temp, setTemp] = useState<DateRange | undefined>(current);

  const syncTemp = () => {
    setTemp(current());
  };

  const handleOpenChange = (v: boolean) => {
    if (v) syncTemp();
    setOpen(v);
  };

  const handleApply = () => {
    if (temp?.from && temp?.to) {
      onApply(dateToIso(temp.from), dateToIso(temp.to));
      setOpen(false);
    }
  };

  const handleCancel = () => {
    syncTemp();
    setOpen(false);
  };

  const today = new Date();
  const display = hasRange
    ? `${format(isoToDate(startDate), "dd MMM yyyy", { locale: ptBR })} – ${format(isoToDate(endDate), "dd MMM yyyy", { locale: ptBR })}`
    : "Todo o período";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-2 h-10 px-3 rounded-lg border border-border bg-white text-sm text-[var(--navy)] font-medium hover:bg-[var(--surface)] transition-colors whitespace-nowrap ${className ?? ""}`}
        >
          <CalendarIcon size={14} className="text-muted-foreground flex-shrink-0" />
          <span>{display}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-3 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Selecione o período</p>
          {temp?.from && (
            <p className="text-sm text-[var(--navy)] mt-1 font-medium">
              {format(temp.from, "dd MMM yyyy", { locale: ptBR })}
              {temp.to && ` – ${format(temp.to, "dd MMM yyyy", { locale: ptBR })}`}
            </p>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap p-3 border-b border-border">
          {onClear && (
            <button
              onClick={() => { onClear(); setOpen(false); }}
              className="px-3 py-1 rounded-full text-xs font-semibold bg-[var(--surface)] border border-border text-[var(--navy)] hover:bg-[var(--gold)]/20 transition-colors"
            >
              Todo o período
            </button>
          )}
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setTemp(p.fn(today))}
              className="px-3 py-1 rounded-full text-xs font-semibold bg-[var(--surface)] border border-border text-[var(--navy)] hover:bg-[var(--gold)]/20 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={temp}
          onSelect={setTemp}
          numberOfMonths={1}
          locale={ptBR}
          defaultMonth={temp?.from}
        />
        <div className="flex gap-2 p-3 border-t border-border">
          <button
            onClick={handleCancel}
            className="flex-1 h-9 rounded-lg bg-[var(--surface)] text-[var(--navy)] text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={handleApply}
            disabled={!temp?.from || !temp?.to}
            className="flex-1 h-9 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <Check size={14} /> Aplicar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
