import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Loader2, Search } from "lucide-react";
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

type Form = Omit<RouletteSettings, "id" | "updated_at">;

const inputCls = "w-full h-11 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm";

type SearchResult = { display_name: string; lat: string; lon: string };

/** Aba "Regras de check-in" (admin): tempos, precisão e locais no mapa. */
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

  if (!form) return <p className="text-sm text-muted-foreground p-4">Carregando…</p>;

  const labels = pdvLabels;

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const num = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, (e.target.value === "" ? 0 : Number(e.target.value)) as never);

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
                    <span className="text-xs text-muted-foreground font-medium">
                      {edge === "start" ? "Início" : "Fim"}
                    </span>
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
        <p className="text-[11px] text-muted-foreground">
          Valem para a escala, as vagas das equipes e o check-in. Ao mudar um horário, as vagas e os
          plantões já lançados dos próximos dias acompanham; hoje e o passado ficam como estavam.
          Sem "Exigir localização", o check-in daquele turno pode ser feito de qualquer lugar (o
          stand-by entra pela Central).
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--navy)]">Check-in</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-muted-foreground font-medium">
              Check-in abre antes do turno (min)
            </span>
            <input
              type="number"
              min={0}
              max={240}
              className={inputCls}
              value={form.checkin_open_before_min}
              onChange={num("checkin_open_before_min")}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground font-medium">Check-in fecha (min)</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                max={240}
                className={inputCls}
                value={Math.abs(form.tolerance_min)}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0);
                  set("tolerance_min", form.tolerance_min < 0 ? -v : v);
                }}
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
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground font-medium">
              Lembrete antes de fechar (min)
            </span>
            <input
              type="number"
              min={0}
              max={240}
              className={inputCls}
              value={form.checkin_reminder_min ?? 10}
              onChange={num("checkin_reminder_min")}
            />
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          O lembrete é um aviso no celular para quem está escalado e ainda não fez check-in; tocar
          nele abre a tela de Check-in (0 desliga). Quando o check-in fecha, as vagas são alocadas
          (sorteio): primeiro a equipe (mesmo local, por ordem de check-in), depois o geral. Se
          houver mais stand-by que vagas, você decide.
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--navy)]">PDVs e GPS</h3>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-muted-foreground font-medium">Raio Central (m)</span>
            <input
              type="number"
              min={10}
              className={inputCls}
              value={form.central_radius_m}
              onChange={num("central_radius_m")}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground font-medium">Raio Plantão (m)</span>
            <input
              type="number"
              min={10}
              className={inputCls}
              value={form.plantao_radius_m}
              onChange={num("plantao_radius_m")}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground font-medium">Precisão máx. GPS (m)</span>
            <input
              type="number"
              min={10}
              className={inputCls}
              value={form.max_accuracy_m}
              onChange={num("max_accuracy_m")}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Posicionar:</span>
          <div className="inline-flex rounded-lg border border-border bg-white p-0.5">
            {(["central", "plantao"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => switchEditing(k)}
                className={`h-8 px-3 rounded-md text-sm font-medium ${editing === k ? "text-white" : "text-muted-foreground"}`}
                style={editing === k ? { backgroundColor: LOCATION_COLOR[k] } : undefined}
              >
                {labels[k]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="h-9 px-3 rounded-lg border border-border bg-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {locating ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}{" "}
            Usar minha localização
          </button>
        </div>

        <form onSubmit={search} className="flex gap-2">
          <input
            className={inputCls}
            placeholder={`Buscar endereço ${editing === "central" ? "da Central" : "do Plantão"}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="submit"
            disabled={searching}
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
                  className="w-full text-left px-3 py-2 hover:bg-[var(--surface)]"
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

        <LazyMap
          places={places}
          focus={focus}
          onPick={(lat, lng) => placeAt(editing, lat, lng)}
          height={360}
        />
        <p className="text-[11px] text-muted-foreground">
          Toque no mapa para posicionar {editing === "central" ? "a Central" : "o Plantão"}. O
          círculo mostra a área aceita para o check-in. O local é salvo assim que você o escolhe.
        </p>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          {(["central", "plantao"] as const).map((k) => (
            <div key={k}>
              <span className="font-semibold" style={{ color: LOCATION_COLOR[k] }}>
                {labels[k]}:
              </span>{" "}
              {form[`${k}_lat`] != null
                ? (form[`${k}_address`] ?? `${form[`${k}_lat`]}, ${form[`${k}_lng`]}`)
                : "não definido"}
            </div>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold disabled:opacity-50"
      >
        {save.isPending ? "Salvando…" : "Salvar regras"}
      </button>
    </div>
  );
}
