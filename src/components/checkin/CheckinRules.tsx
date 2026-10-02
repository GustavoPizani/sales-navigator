import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Loader2, Search } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  LOCATION_COLOR,
  getPosition,
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
  // PDV Plantão = um produto (imóvel) com localização própria
  const projectsQ = useQuery({
    queryKey: ["pdv-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name,address,city,latitude,longitude")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
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
    }
  }, [settingsQ.data, form]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("roulette_settings")
        .update({ ...form!, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
      // a localização marcada também fica salva no produto
      if (form!.plantao_project_id && form!.plantao_lat != null && form!.plantao_lng != null) {
        const { error: pErr } = await supabase
          .from("projects")
          .update({ latitude: form!.plantao_lat, longitude: form!.plantao_lng })
          .eq("id", form!.plantao_project_id);
        if (pErr) throw pErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roulette-settings"] });
      qc.invalidateQueries({ queryKey: ["pdv-projects"] });
      qc.invalidateQueries({ queryKey: ["pdv-project"] });
      toast.success("Regras de check-in salvas!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!form) return <p className="text-sm text-muted-foreground p-4">Carregando…</p>;

  const chosen = (projectsQ.data ?? []).find((p) => p.id === form.plantao_project_id);
  const labels = {
    central: pdvLabels.central,
    plantao: chosen ? `Plantão ${chosen.name}` : "Plantão",
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const num = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, (e.target.value === "" ? 0 : Number(e.target.value)) as never);

  const placeAt = (loc: RouletteLocation, lat: number, lng: number) => {
    setForm((f) =>
      f
        ? { ...f, [`${loc}_lat`]: Number(lat.toFixed(7)), [`${loc}_lng`]: Number(lng.toFixed(7)) }
        : f,
    );
    setFocus({ lat, lng });
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
      placeAt(editing, pos.coords.latitude, pos.coords.longitude);
      toast.success(
        `${labels[editing]} definida na sua posição (± ${Math.round(pos.coords.accuracy)} m).`,
      );
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
        <h3 className="text-sm font-semibold text-[var(--navy)]">Horários</h3>
        <div className="grid grid-cols-2 gap-3">
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
            <span className="text-xs text-muted-foreground font-medium">
              Tolerância após o início (min)
            </span>
            <input
              type="number"
              min={0}
              max={240}
              className={inputCls}
              value={form.tolerance_min}
              onChange={num("tolerance_min")}
            />
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          No fim da tolerância o check-in fecha e as vagas são alocadas: primeiro a equipe (mesmo
          local, por ordem de check-in), depois o geral. Se houver mais stand-by que vagas, você
          decide.
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--navy)]">PDVs e GPS</h3>
        <label className="block">
          <span className="text-xs text-muted-foreground font-medium">Produto do PDV Plantão</span>
          <select
            className={inputCls}
            value={form.plantao_project_id ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              set("plantao_project_id", id);
              const p = (projectsQ.data ?? []).find((x) => x.id === id);
              setEditing("plantao");
              if (p?.latitude != null && p.longitude != null)
                placeAt("plantao", p.latitude, p.longitude);
              else if (p) {
                setQuery(`${p.address}, ${p.city}`);
                toast("Marque a localização do plantão no mapa ou busque o endereço.", {
                  icon: "📍",
                });
              }
            }}
          >
            <option value="">Selecione o produto…</option>
            {(projectsQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
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
                onClick={() => setEditing(k)}
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
                    placeAt(editing, Number(r.lat), Number(r.lon));
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
          círculo mostra a área aceita para o check-in.
        </p>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          {(["central", "plantao"] as const).map((k) => (
            <div key={k}>
              <span className="font-semibold" style={{ color: LOCATION_COLOR[k] }}>
                {labels[k]}:
              </span>{" "}
              {form[`${k}_lat`] != null
                ? `${form[`${k}_lat`]}, ${form[`${k}_lng`]}`
                : "não definida"}
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
