import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { Avatar } from "@/components/Avatar";
import {
  LOCATION_COLOR,
  STATUS_INFO,
  allocationTime,
  hhmm,
  locationOfModality,
  usePdvLabels,
  useRouletteSettings,
  type CheckinStatus,
  type RouletteLocation,
} from "@/hooks/useRoulette";
import { LazyMap, type MapPlace, type MapPoint } from "./LazyMap";

type Slot = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  config: { id: string; manager_id: string; modality: string | null } | null;
};
type Manager = { id: string; full_name: string; team_name: string | null; color: string };

const turnKey = (s: { start_time: string; end_time: string }) =>
  `${hhmm(s.start_time)}-${hhmm(s.end_time)}`;

/**
 * Aba "Acompanhamento do turno": vagas por equipe/local, escalados, stand-by,
 * mapa dos check-ins e — para o admin — a decisão manual das vagas.
 */
export function TurnMonitor({ canDecide }: { canDecide: boolean }) {
  const qc = useQueryClient();
  const settingsQ = useRouletteSettings();
  const labels = usePdvLabels();
  const cfg = settingsQ.data;
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [turn, setTurn] = useState<string>("");

  const slotsQ = useQuery({
    queryKey: ["monitor-slots", date],
    refetchInterval: 30_000,
    queryFn: async (): Promise<Slot[]> => {
      const { data, error } = await supabase
        .from("shift_slots")
        .select(
          "id,date,start_time,end_time,capacity, config:shift_configs(id,manager_id,modality)",
        )
        .eq("date", date)
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as unknown as Slot[];
    },
  });
  const managersQ = useQuery({
    queryKey: ["monitor-managers"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Manager[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,team_name,color")
        .eq("role", "master");
      if (error) throw error;
      return data ?? [];
    },
  });
  const shiftsQ = useQuery({
    queryKey: ["monitor-shifts", date],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select(
          "id,broker_id,start_time,end_time,slot_id,missed_at, broker:profiles!shifts_broker_id_fkey(full_name,color,manager_id,avatar_url)",
        )
        .eq("date", date);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const checkinsQ = useQuery({
    queryKey: ["monitor-checkins", date],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roulette_checkins")
        .select("*, broker:profiles!roulette_checkins_broker_id_fkey(full_name,color,avatar_url)")
        .eq("turn_date", date)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const turnsQ = useQuery({
    queryKey: ["monitor-turns", date],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roulette_turns")
        .select("*")
        .eq("turn_date", date);
      if (error) throw error;
      return data ?? [];
    },
  });

  const slots = slotsQ.data ?? [];
  const turnOptions = useMemo(() => [...new Set(slots.map(turnKey))], [slots]);
  const current = turn && turnOptions.includes(turn) ? turn : pickDefaultTurn(turnOptions, date);
  const managersById = new Map((managersQ.data ?? []).map((m) => [m.id, m]));

  const tSlots = slots.filter((s) => turnKey(s) === current);
  const tShifts = (shiftsQ.data ?? []).filter((s) => turnKey(s) === current);
  const tCheckins = (checkinsQ.data ?? []).filter((c) => turnKey(c) === current);
  const tState = (turnsQ.data ?? []).find((t) => turnKey(t) === current);
  const occupied = (slotId: string) =>
    tCheckins.filter(
      (c) => c.slot_id === slotId && (c.status === "validated" || c.status === "allocated"),
    ).length;

  const decide = useMutation({
    mutationFn: async ({ checkinId, slotId }: { checkinId: string; slotId: string | null }) => {
      const { error } = await supabase.rpc("crm_roulette_admin_decide", {
        p_checkin_id: checkinId,
        p_slot_id: slotId,
      });
      if (error) throw error;
      return slotId;
    },
    onSuccess: (slotId) => {
      qc.invalidateQueries({ queryKey: ["monitor-checkins"] });
      qc.invalidateQueries({ queryKey: ["monitor-turns"] });
      toast.success(slotId ? "Corretor alocado na vaga." : "Corretor deixado de fora do turno.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const teamName = (managerId: string | null | undefined) => {
    const m = managerId ? managersById.get(managerId) : undefined;
    return m ? m.team_name || m.full_name : "Sem equipe";
  };
  const teamColor = (managerId: string | null | undefined) =>
    (managerId && managersById.get(managerId)?.color) || "#A8A8A8";

  const places: MapPlace[] = [];
  if (cfg?.central_lat != null && cfg.central_lng != null)
    places.push({
      key: "central",
      label: "Central",
      lat: cfg.central_lat,
      lng: cfg.central_lng,
      radius: cfg.central_radius_m,
      color: LOCATION_COLOR.central,
    });
  if (cfg?.plantao_lat != null && cfg.plantao_lng != null)
    places.push({
      key: "plantao",
      label: labels.plantao,
      lat: cfg.plantao_lat,
      lng: cfg.plantao_lng,
      radius: cfg.plantao_radius_m,
      color: LOCATION_COLOR.plantao,
    });
  const points: MapPoint[] = tCheckins.map((c) => ({
    id: c.id,
    lat: c.lat,
    lng: c.lng,
    color: STATUS_INFO[c.status as CheckinStatus].color,
    label: `${c.broker?.full_name ?? "Corretor"} · ${STATUS_INFO[c.status as CheckinStatus].label}`,
  }));

  const firstSlot = tSlots[0];
  const allocAt =
    firstSlot && cfg
      ? allocationTime(firstSlot.date, firstSlot.start_time, cfg.tolerance_min)
      : null;
  const waiting = tCheckins.filter((c) => c.status === "waiting_admin");
  const standbys = tCheckins.filter((c) => c.kind === "standby");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setTurn("");
          }}
          className="h-10 px-3 rounded-lg bg-white border border-border text-sm"
        />
        {turnOptions.length > 0 && (
          <div className="inline-flex flex-wrap rounded-lg border border-border bg-white p-0.5">
            {turnOptions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTurn(t)}
                className={`h-9 px-3 rounded-md text-sm font-medium ${t === current ? "bg-[var(--navy)] text-white" : "text-muted-foreground"}`}
              >
                {t.replace("-", "–")}
              </button>
            ))}
          </div>
        )}
      </div>

      {turnOptions.length === 0 && (
        <div className="bg-white rounded-2xl border border-border p-8 text-center text-sm text-muted-foreground">
          Nenhuma vaga de escala neste dia.
        </div>
      )}

      {current && (
        <>
          {/* Situação do turno */}
          <div
            className={`rounded-2xl border p-4 flex items-start gap-3 ${
              tState?.needs_admin
                ? "bg-orange-50 border-orange-200"
                : tState?.processed_at
                  ? "bg-green-50 border-green-200"
                  : "bg-white border-border"
            }`}
          >
            {tState?.needs_admin ? (
              <AlertTriangle className="text-orange-600 flex-shrink-0" size={20} />
            ) : tState?.processed_at ? (
              <CheckCircle2 className="text-green-600 flex-shrink-0" size={20} />
            ) : (
              <Clock className="text-muted-foreground flex-shrink-0" size={20} />
            )}
            <div className="text-sm">
              {tState?.needs_admin ? (
                <p className="font-semibold text-orange-800">
                  Há mais stand-by do que vagas.{" "}
                  {canDecide
                    ? "Decida abaixo quem assume as vagas."
                    : "O administrador vai decidir."}
                </p>
              ) : tState?.processed_at ? (
                <p className="font-semibold text-green-800">
                  Alocação concluída às {format(new Date(tState.processed_at), "HH:mm")}.
                </p>
              ) : (
                <p className="font-semibold text-[var(--navy)]">
                  Check-in aberto
                  {allocAt ? ` — a alocação acontece às ${format(allocAt, "HH:mm")}` : ""}.
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                {tShifts.length} escalado(s) · {standbys.length} stand-by
              </p>
            </div>
          </div>

          {/* Vagas por equipe e local */}
          <section className="bg-white rounded-2xl border border-border p-4">
            <h3 className="text-sm font-semibold text-[var(--navy)] mb-2">Vagas do turno</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1.5 pr-2 font-semibold">Equipe</th>
                    <th className="py-1.5 pr-2 font-semibold">Local</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Vagas</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Ocupadas</th>
                    <th className="py-1.5 font-semibold text-right">Abertas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tSlots.map((s) => {
                    const occ = occupied(s.id);
                    const open = Math.max(0, s.capacity - occ);
                    const loc = locationOfModality(s.config?.modality);
                    return (
                      <tr key={s.id}>
                        <td className="py-2 pr-2">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: teamColor(s.config?.manager_id) }}
                            />
                            {teamName(s.config?.manager_id)}
                          </span>
                        </td>
                        <td className="py-2 pr-2">{labels[loc]}</td>
                        <td className="py-2 pr-2 text-right">{s.capacity}</td>
                        <td className="py-2 pr-2 text-right">{occ}</td>
                        <td
                          className={`py-2 text-right font-semibold ${open > 0 ? "text-[var(--gold-dark)]" : "text-muted-foreground"}`}
                        >
                          {open}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Decisão manual */}
          {waiting.length > 0 && (
            <section className="bg-white rounded-2xl border border-orange-200 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-orange-800">
                Aguardando decisão ({waiting.length})
              </h3>
              {waiting.map((c) => {
                const options = tSlots.filter(
                  (s) =>
                    locationOfModality(s.config?.modality) === c.location &&
                    s.capacity - occupied(s.id) > 0,
                );
                return (
                  <DecisionRow
                    key={c.id}
                    name={c.broker?.full_name ?? "Corretor"}
                    color={c.broker?.color ?? "#A8A8A8"}
                    avatarUrl={c.broker?.avatar_url}
                    detail={`${teamName(c.team_manager_id)} · está em ${labels[c.location as RouletteLocation]} · check-in ${format(new Date(c.created_at), "HH:mm")}`}
                    options={options.map((s) => ({
                      id: s.id,
                      label: `${teamName(s.config?.manager_id)} — ${labels[locationOfModality(s.config?.modality)]}`,
                    }))}
                    canDecide={canDecide}
                    busy={decide.isPending}
                    onAllocate={(slotId) => decide.mutate({ checkinId: c.id, slotId })}
                    onReject={() => decide.mutate({ checkinId: c.id, slotId: null })}
                  />
                );
              })}
            </section>
          )}

          {/* Escalados */}
          <section className="bg-white rounded-2xl border border-border p-4">
            <h3 className="text-sm font-semibold text-[var(--navy)] mb-2">Escalados</h3>
            {tShifts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ninguém escalado neste turno.</p>
            ) : (
              <ul className="divide-y divide-border">
                {tShifts.map((s) => {
                  const c = tCheckins.find((x) => x.shift_id === s.id);
                  const slot = tSlots.find((x) => x.id === s.slot_id);
                  return (
                    <li key={s.id} className="py-2 flex items-center gap-3 text-sm">
                      <Avatar
                        name={s.broker?.full_name ?? "?"}
                        color={s.broker?.color ?? "#A8A8A8"}
                        src={s.broker?.avatar_url}
                        size={32}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[var(--navy)] truncate">
                          {s.broker?.full_name}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {teamName(s.broker?.manager_id)} ·{" "}
                          {labels[locationOfModality(slot?.config?.modality)]}
                          {c && ` · check-in ${format(new Date(c.created_at), "HH:mm")}`}
                        </div>
                      </div>
                      {c ? (
                        <StatusBadge status={c.status} />
                      ) : s.missed_at ? (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                          Falta
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--surface)] text-muted-foreground">
                          Pendente
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Stand-by */}
          <section className="bg-white rounded-2xl border border-border p-4">
            <h3 className="text-sm font-semibold text-[var(--navy)] mb-2">
              Stand-by (ordem de check-in)
            </h3>
            {standbys.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum stand-by neste turno.</p>
            ) : (
              <ol className="divide-y divide-border">
                {standbys.map((c, i) => (
                  <li key={c.id} className="py-2 flex items-center gap-3 text-sm">
                    <span className="w-5 text-xs text-muted-foreground text-right">{i + 1}.</span>
                    <Avatar
                      name={c.broker?.full_name ?? "?"}
                      color={c.broker?.color ?? "#A8A8A8"}
                      src={c.broker?.avatar_url}
                      size={32}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[var(--navy)] truncate">
                        {c.broker?.full_name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {teamName(c.team_manager_id)} · {labels[c.location as RouletteLocation]} ·{" "}
                        {format(new Date(c.created_at), "HH:mm")}
                      </div>
                    </div>
                    <StatusBadge status={c.status} />
                  </li>
                ))}
              </ol>
            )}
          </section>

          {places.length > 0 && (
            <section className="bg-white rounded-2xl border border-border p-4">
              <h3 className="text-sm font-semibold text-[var(--navy)] mb-2">Mapa dos check-ins</h3>
              <LazyMap places={places} points={points} height={320} />
            </section>
          )}
          {places.length === 0 && canDecide && (
            <p className="text-xs text-muted-foreground">
              Defina a Central e o Plantão na aba "Regras de check-in" para ver o mapa e liberar os
              check-ins.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function pickDefaultTurn(options: string[], date: string) {
  if (options.length === 0) return "";
  if (date !== format(new Date(), "yyyy-MM-dd")) return options[0];
  const now = format(new Date(), "HH:mm");
  // turno em andamento ou o próximo
  return options.find((t) => t.split("-")[1] > now) ?? options[options.length - 1];
}

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_INFO[status as CheckinStatus];
  return (
    <span
      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${info.className}`}
    >
      {info.label}
    </span>
  );
}

function DecisionRow({
  name,
  color,
  avatarUrl,
  detail,
  options,
  canDecide,
  busy,
  onAllocate,
  onReject,
}: {
  name: string;
  color: string;
  avatarUrl?: string | null;
  detail: string;
  options: { id: string; label: string }[];
  canDecide: boolean;
  busy: boolean;
  onAllocate: (slotId: string) => void;
  onReject: () => void;
}) {
  const [slotId, setSlotId] = useState("");
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center gap-3">
        <Avatar name={name} color={color} src={avatarUrl} size={32} />
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--navy)] truncate">{name}</div>
          <div className="text-[11px] text-muted-foreground">{detail}</div>
        </div>
      </div>
      {canDecide && (
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            value={slotId}
            onChange={(e) => setSlotId(e.target.value)}
            className="h-9 px-2 rounded-lg border border-border bg-white text-sm flex-1 min-w-[180px]"
          >
            <option value="">
              {options.length ? "Escolha a vaga…" : "Sem vaga aberta neste local"}
            </option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!slotId || busy}
            onClick={() => onAllocate(slotId)}
            className="h-9 px-3 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold disabled:opacity-50"
          >
            Alocar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className="h-9 px-3 rounded-lg bg-[var(--surface)] text-[var(--navy)] text-sm font-medium disabled:opacity-50"
          >
            Deixar de fora
          </button>
        </div>
      )}
    </div>
  );
}
