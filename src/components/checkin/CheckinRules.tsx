import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Crosshair, Loader2, MapPin, Search } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_SHIFT_PERIODS,
  LOCATION_COLOR,
  getPosition,
  hhmm,
  usePdvLabels,
  useRouletteSettings,
  type RouletteLocation,
  type RouletteSettings,
} from "@/hooks/useRoulette";
import { LazyMap, type MapPlace } from "./LazyMap";
import { confirmDialog } from "@/components/ConfirmDialog";

type Form = Omit<RouletteSettings, "id" | "updated_at">;

const inputCls = "w-full h-11 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm";
const labelCls = "text-xs text-muted-foreground font-medium";
const helpCls = "text-xs text-muted-foreground";

type SearchResult = { display_name: string; lat: string; lon: string };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** "09:00" + (-60) → "08:00" */
const addMin = (t: string, delta: number) => {
  const m = (((toMin(t) + delta) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// O local do PDV (ponto e endereço) é gravado na hora; o resto espera o "Salvar".
const isLocationKey = (k: string) => /_(lat|lng|address)$/.test(k);
const isTimeKey = (k: string) => /_(start|end)$/.test(k);
const sameValue = (k: string, a: unknown, b: unknown) =>
  isTimeKey(k) ? hhmm(String(a ?? "")) === hhmm(String(b ?? "")) : a === b;

/**
 * Campo numérico que deixa apagar para digitar outro valor: o formulário só
 * muda quando há um número; vazio, volta ao valor anterior ao sair do campo.
 */
function NumberField({
  value,
  onChange,
  min,
  max,
  className = inputCls,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      className={className}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value !== "" && !Number.isNaN(Number(e.target.value)))
          onChange(Number(e.target.value));
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

/** Aba "Regras" (admin): turnos, prazos do check-in e os dois PDVs. */
export function CheckinRules() {
  const qc = useQueryClient();
  const settingsQ = useRouletteSettings();
  const pdvLabels = usePdvLabels();
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<RouletteLocation>("central");
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  // produto que dá nome ao Plantão ("Plantão <produto>")
  const projectsQ = useQuery({
    queryKey: ["projects-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  useEffect(() => {
    if (settingsQ.data && !form) {
      const { id: _id, updated_at: _u, ...rest } = settingsQ.data;
      setForm(rest);
      // abre já mostrando o endereço salvo da Central
      setQuery(rest.central_address ?? "");
    }
  }, [settingsQ.data, form]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("roulette_settings")
        .update({ ...form!, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roulette-settings"] });
      qc.invalidateQueries({ queryKey: ["shift-slots-capacity"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      toast.success("Regras de check-in salvas!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!form || !settingsQ.data)
    return <p className="text-sm text-muted-foreground p-4">Carregando…</p>;

  const saved = settingsQ.data as unknown as Record<string, unknown>;
  const labels = pdvLabels;

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  // o que mudou e ainda não foi salvo (o local dos PDVs não entra: grava na hora)
  const dirtyKeys = Object.keys(form).filter(
    (k) => !isLocationKey(k) && !sameValue(k, (form as Record<string, unknown>)[k], saved[k]),
  );
  const dirty = dirtyKeys.length > 0;
  const turnsChanged = dirtyKeys.some(isTimeKey);

  const periods = DEFAULT_SHIFT_PERIODS.map((p) => ({
    ...p,
    start: form[`${p.key}_start`] ? hhmm(form[`${p.key}_start`]) : p.start,
    end: form[`${p.key}_end`] ? hhmm(form[`${p.key}_end`]) : p.end,
  }));

  const errors: string[] = [];
  periods.forEach((p, i) => {
    if (toMin(p.end) <= toMin(p.start)) errors.push(`${p.label}: o fim precisa ser depois do início.`);
    const next = periods[i + 1];
    if (next && toMin(p.end) > toMin(next.start))
      errors.push(`${p.label} termina depois do início de ${next.label}.`);
  });
  const inRange = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;
  if (!inRange(form.checkin_open_before_min, 0, 240))
    errors.push("A abertura do check-in deve ficar entre 0 e 240 min.");
  if (!inRange(Math.abs(form.tolerance_min), 0, 240))
    errors.push("O fechamento do check-in deve ficar entre 0 e 240 min.");
  if (form.checkin_open_before_min + form.tolerance_min <= 0)
    errors.push("O check-in fecharia antes de abrir: abra mais cedo ou feche mais tarde.");
  if (!inRange(form.checkin_reminder_min ?? 10, 0, 240))
    errors.push("O lembrete deve ficar entre 0 e 240 min.");
  if (!(form.central_radius_m >= 10)) errors.push("O raio da Central deve ter pelo menos 10 m.");
  if (!(form.plantao_radius_m >= 10)) errors.push("O raio do Plantão deve ter pelo menos 10 m.");
  if (!(form.max_accuracy_m >= 10)) errors.push("A precisão do GPS deve ser de pelo menos 10 m.");

  const trySave = async () => {
    if (errors.length) return toast.error(errors[0]);
    if (
      turnsChanged &&
      !(await confirmDialog({
        title: "Mudar o horário do turno?",
        description:
          "As vagas e os plantões já lançados dos próximos dias vão acompanhar o novo horário. Hoje e o passado ficam como estão.",
        confirmLabel: "Salvar regras",
      }))
    )
      return;
    save.mutate();
  };

  const discard = () => {
    const { id: _id, updated_at: _u, ...rest } = settingsQ.data!;
    setForm(rest);
  };

  // Posiciona o PDV e grava na hora (ponto + endereço), sem depender do
  // botão "Salvar regras".
  const placeAt = async (
    loc: RouletteLocation,
    rawLat: number,
    rawLng: number,
    address?: string,
  ) => {
    const lat = Number(rawLat.toFixed(7));
    const lng = Number(rawLng.toFixed(7));
    setFocus({ lat, lng });
    setForm((f) => (f ? { ...f, [`${loc}_lat`]: lat, [`${loc}_lng`]: lng } : f));

    let addr = address;
    if (!addr) {
      // clique no mapa / minha localização: descobre o endereço do ponto
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}`,
          { headers: { "Accept-Language": "pt-BR" } },
        );
        addr = ((await r.json()) as { display_name?: string }).display_name;
      } catch {
        /* sem endereço: fica só o ponto */
      }
    }
    addr = addr ?? `${lat}, ${lng}`;
    setForm((f) => (f ? { ...f, [`${loc}_address`]: addr } : f));
    setQuery(addr);

    const point = {
      [`${loc}_lat`]: lat,
      [`${loc}_lng`]: lng,
      updated_at: new Date().toISOString(),
    };
    let { error } = await supabase
      .from("roulette_settings")
      .update({ ...point, [`${loc}_address`]: addr } as never)
      .eq("id", 1);
    // banco ainda sem a coluna de endereço: grava ao menos o ponto
    if (error)
      ({ error } = await supabase
        .from("roulette_settings")
        .update(point as never)
        .eq("id", 1));
    if (error) return toast.error(`Não foi possível salvar o local: ${error.message}`);
    qc.invalidateQueries({ queryKey: ["roulette-settings"] });
    toast.success(`Local ${loc === "central" ? "da Central" : "do Plantão"} salvo.`);
  };

  const switchEditing = (k: RouletteLocation) => {
    setEditing(k);
    setResults([]);
    setQuery(form[`${k}_address`] ?? "");
    const lat = form[`${k}_lat`];
    const lng = form[`${k}_lng`];
    if (lat != null && lng != null) setFocus({ lat, lng });
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=5&q=${encodeURIComponent(query)}`;
      const r = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
      const data = (await r.json()) as SearchResult[];
      setResults(data);
      if (data.length === 0) toast("Nenhum endereço encontrado.", { icon: "🔎" });
    } catch {
      toast.error("Não foi possível buscar o endereço.");
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const pos = await getPosition();
      await placeAt(editing, pos.coords.latitude, pos.coords.longitude);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLocating(false);
    }
  };

  const places: MapPlace[] = (["central", "plantao"] as const)
    .filter((k) => form[`${k}_lat`] != null && form[`${k}_lng`] != null)
    .map((k) => ({
      key: k,
      label: labels[k],
      lat: form[`${k}_lat`]!,
      lng: form[`${k}_lng`]!,
      radius: form[`${k}_radius_m`],
      color: LOCATION_COLOR[k],
    }));

  const reminder = form.checkin_reminder_min ?? 10;
  const editingName = editing === "central" ? "da Central" : "do Plantão";

  return (
    <div className="space-y-3">
      <section className="bg-white rounded-2xl border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--navy)]">Turnos</h3>
        <div className="space-y-2">
          {DEFAULT_SHIFT_PERIODS.map((p) => (
            <div
              key={p.key}
              className="grid grid-cols-[4.5rem_1fr_1fr] sm:grid-cols-[4.5rem_1fr_1fr_auto] items-end gap-3"
            >
              <span className="text-sm font-semibold text-[var(--navy)] pb-3">{p.label}</span>
              {(["start", "end"] as const).map((edge) => {
                const field = `${p.key}_${edge}` as const;
                return (
                  <label key={edge} className="block">
                    <span className={labelCls}>{edge === "start" ? "Início" : "Fim"}</span>
                    <input
                      type="time"
                      className={inputCls}
                      value={form[field] ? hhmm(form[field]) : p[edge]}
                      onChange={(e) => e.target.value && set(field, e.target.value)}
                    />
                  </label>
                );
              })}
              <label className="col-span-3 sm:col-span-1 flex h-11 items-center gap-2 text-sm text-[var(--navy)] cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--gold)]"
                  checked={form[`${p.key}_require_gps`] ?? true}
                  onChange={(e) => set(`${p.key}_require_gps`, e.target.checked)}
                />
                Exigir localização
              </label>
            </div>
          ))}
        </div>
        <ul className={`${helpCls} list-disc pl-4 space-y-0.5`}>
          <li>Os horários valem para a escala, as vagas das equipes e o check-in.</li>
          <li>
            Ao mudar um horário, as vagas e os plantões já lançados dos próximos dias acompanham;
            hoje e o passado ficam como estavam.
          </li>
          <li>
            Sem "Exigir localização", o check-in daquele turno pode ser feito de qualquer lugar (o
            stand-by entra pela Central).
          </li>
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--navy)]">Prazos do check-in</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block">
            <span className={labelCls}>Abre antes do turno (min)</span>
            <NumberField
              min={0}
              max={240}
              value={form.checkin_open_before_min}
              onChange={(v) => set("checkin_open_before_min", v)}
            />
          </label>
          <div>
            <span className={labelCls}>Fecha (min)</span>
            <div className="flex gap-2">
              <NumberField
                min={0}
                max={240}
                value={Math.abs(form.tolerance_min)}
                onChange={(v) =>
                  set("tolerance_min", form.tolerance_min < 0 ? -Math.abs(v) : Math.abs(v))
                }
              />
              <select
                className={inputCls}
                value={form.tolerance_min < 0 ? "before" : "after"}
                onChange={(e) =>
                  set(
                    "tolerance_min",
                    e.target.value === "before"
                      ? -Math.abs(form.tolerance_min)
                      : Math.abs(form.tolerance_min),
                  )
                }
                aria-label="Antes ou depois do início"
              >
                <option value="before">antes do início</option>
                <option value="after">depois do início</option>
              </select>
            </div>
          </div>
          <label className="block">
            <span className={labelCls}>Lembrete antes de fechar (min)</span>
            <NumberField
              min={0}
              max={240}
              value={reminder}
              onChange={(v) => set("checkin_reminder_min", v)}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Precisão mínima do GPS (m)</span>
            <NumberField
              min={10}
              value={form.max_accuracy_m}
              onChange={(v) => set("max_accuracy_m", v)}
            />
          </label>
        </div>

        {/* como os números acima ficam em cada turno */}
        <div className="rounded-xl bg-[var(--surface)] border border-border p-3">
          <p className="text-xs font-semibold text-[var(--navy)] mb-1">Com esses prazos:</p>
          <ul className="text-xs text-[var(--navy)] space-y-0.5">
            {periods.map((p) => {
              const closes = addMin(p.start, form.tolerance_min);
              return (
                <li key={p.key}>
                  <span className="font-semibold">
                    {p.label} ({p.start}):
                  </span>{" "}
                  check-in das {addMin(p.start, -form.checkin_open_before_min)} às {closes}
                  {reminder > 0 ? `, lembrete às ${addMin(closes, -reminder)}` : ", sem lembrete"}.
                </li>
              );
            })}
          </ul>
        </div>
        <ul className={`${helpCls} list-disc pl-4 space-y-0.5`}>
          <li>
            O lembrete é um aviso no celular para quem está escalado e ainda não fez check-in; 0
            desliga.
          </li>
          <li>
            Quando o check-in fecha, as vagas são alocadas: primeiro a equipe (mesmo local, por
            ordem de check-in), depois o geral. Se houver mais stand-by que vagas, você decide.
          </li>
          <li>
            Precisão do GPS: leituras com margem de erro maior que esse valor são recusadas.
          </li>
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--navy)]">Locais de check-in (PDVs)</h3>

        {/* um bloco por PDV: endereço, raio e, no Plantão, o produto que dá o nome */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(["central", "plantao"] as const).map((k) => {
            const active = editing === k;
            const hasPoint = form[`${k}_lat`] != null;
            return (
              <div
                key={k}
                className={`rounded-xl border p-3 space-y-2.5 ${active ? "border-[var(--navy)] ring-1 ring-[var(--navy)]" : "border-border"}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: LOCATION_COLOR[k] }}
                  />
                  <span className="font-semibold text-[var(--navy)] truncate">{labels[k]}</span>
                </div>
                <p
                  className={`text-xs flex items-start gap-1.5 ${hasPoint ? "text-muted-foreground" : "text-amber-700 font-medium"}`}
                >
                  <MapPin size={13} className="flex-shrink-0 mt-0.5" />
                  {hasPoint
                    ? (form[`${k}_address`] ?? `${form[`${k}_lat`]}, ${form[`${k}_lng`]}`)
                    : "Local ainda não definido: sem ele, o check-in aqui não funciona."}
                </p>
                {k === "plantao" && (
                  <label className="block">
                    <span className={labelCls}>Produto do plantão</span>
                    <select
                      className={inputCls}
                      value={form.plantao_project_id ?? ""}
                      onChange={(e) => set("plantao_project_id", e.target.value || null)}
                    >
                      <option value="">Sem produto (aparece só "Plantão")</option>
                      {(projectsQ.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block">
                  <span className={labelCls}>Raio aceito (m)</span>
                  <NumberField
                    min={10}
                    value={form[`${k}_radius_m`]}
                    onChange={(v) => set(`${k}_radius_m`, v)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => switchEditing(k)}
                  className={`w-full h-10 rounded-lg text-sm font-semibold ${active ? "bg-[var(--navy)] text-white" : "bg-white border border-border text-[var(--navy)]"}`}
                >
                  {active ? "Editando o local abaixo" : hasPoint ? "Mudar o local" : "Definir o local"}
                </button>
              </div>
            );
          })}
        </div>

        {/* editor de local: sempre diz de qual PDV é */}
        <div className="rounded-xl border border-border p-3 space-y-3">
          <p className="text-sm font-semibold text-[var(--navy)] flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: LOCATION_COLOR[editing] }}
            />
            Local {editingName}
          </p>
          <form onSubmit={search} className="flex gap-2">
            <input
              className={inputCls}
              placeholder={`Buscar endereço ${editingName}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              disabled={searching}
              aria-label="Buscar endereço"
              className="h-11 px-4 rounded-xl bg-[var(--navy)] text-white inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            </button>
          </form>
          {results.length > 0 && (
            <ul className="rounded-xl border border-border divide-y divide-border text-sm">
              {results.map((r) => (
                <li key={`${r.lat},${r.lon}`}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2.5 hover:bg-[var(--surface)]"
                    onClick={() => {
                      placeAt(editing, Number(r.lat), Number(r.lon), r.display_name);
                      setResults([]);
                    }}
                  >
                    {r.display_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="h-10 px-3 rounded-lg border border-border bg-white text-sm font-medium text-[var(--navy)] inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {locating ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
            Usar minha localização
          </button>

          <LazyMap
            places={places}
            focus={focus}
            onPick={(lat, lng) => placeAt(editing, lat, lng)}
            height={320}
          />
          <p className={helpCls}>
            Tocar no mapa move o local {editingName}. O círculo mostra a área aceita para o
            check-in. O local é gravado assim que você o escolhe, sem precisar de "Salvar".
          </p>
        </div>
      </section>

      {/* barra fixa: só aparece quando há algo por salvar */}
      {dirty ? (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] lg:bottom-4 z-30 bg-white rounded-2xl border border-[var(--gold)] shadow-lg p-3 flex flex-wrap items-center gap-2">
          <div className="mr-auto min-w-0">
            <p className="text-sm font-semibold text-[var(--navy)]">Alterações não salvas</p>
            {errors.length > 0 && (
              <p className="text-xs text-red-700 flex items-start gap-1 mt-0.5">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                {errors[0]}
                {errors.length > 1 && ` (+${errors.length - 1})`}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={discard}
            disabled={save.isPending}
            className="h-10 px-3 rounded-lg bg-[var(--surface)] text-[var(--navy)] text-sm font-medium disabled:opacity-50"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={trySave}
            disabled={save.isPending || errors.length > 0}
            className="h-10 px-4 rounded-lg bg-[var(--gold)] text-[var(--navy)] text-sm font-bold disabled:opacity-50"
          >
            {save.isPending ? "Salvando…" : "Salvar regras"}
          </button>
        </div>
      ) : (
        <p className={`${helpCls} text-center`}>Todas as regras estão salvas.</p>
      )}
    </div>
  );
}
