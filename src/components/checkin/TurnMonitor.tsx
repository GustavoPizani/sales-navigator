import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { Avatar } from "@/components/Avatar";
import {
  LOCATION_COLOR,
  STATUS_INFO,
  allocationTime,
  checkinOpensAt,
  hhmm,
  locationOfModality,
  usePdvLabels,
  useRouletteSettings,
  useShiftPeriods,
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

const isConfirmed = (status: string | undefined) => status === "validated" || status === "allocated";

/**
 * Aba "Turno": situação e resumo do turno, cada equipe com suas vagas e seus
 * escalados, stand-by, mapa dos check-ins e — para o admin — a decisão manual
 * das vagas.
 */
export function TurnMonitor({ canDecide }: { canDecide: boolean }) {
  const qc = useQueryClient();
  const settingsQ = useRouletteSettings();
  const labels = usePdvLabels();
  const periods = useShiftPeriods();
  const cfg = settingsQ.data;
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [date, setDate] = useState(todayStr);
  const [turn, setTurn] = useState<string>("");
  const [mapOpen, setMapOpen] = useState(false);

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
  // "Manhã" para o turno que começa no horário da manhã nas regras; sem nome, só o horário
  const turnName = (t: string) => periods.find((p) => p.start === t.split("-")[0])?.label;

  const tSlots = slots.filter((s) => turnKey(s) === current);
  const tShifts = (shiftsQ.data ?? []).filter((s) => turnKey(s) === current);
  const tCheckins = (checkinsQ.data ?? []).filter((c) => turnKey(c) === current);
  const tState = (turnsQ.data ?? []).find((t) => turnKey(t) === current);
  const occupied = (slotId: string) =>
    tCheckins.filter((c) => c.slot_id === slotId && isConfirmed(c.status)).length;

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
  // check-ins de turnos sem exigência de localização não têm ponto no mapa
  const points: MapPoint[] = tCheckins
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({
      id: c.id,
      lat: c.lat as number,
      lng: c.lng as number,
      color: STATUS_INFO[c.status as CheckinStatus].color,
      label: `${c.broker?.full_name ?? "Corretor"} · ${STATUS_INFO[c.status as CheckinStatus].label}`,
    }));

  const firstSlot = tSlots[0];
  const opensAt =
    firstSlot && cfg
      ? checkinOpensAt(firstSlot.date, firstSlot.start_time, cfg.checkin_open_before_min)
      : null;
  const allocAt =
    firstSlot && cfg
      ? allocationTime(firstSlot.date, firstSlot.start_time, cfg.tolerance_min)
      : null;
  const now = Date.now();
  // situação do check-in quando o turno ainda não foi processado
  const phase: "before" | "open" | "after" | null =
    opensAt && allocAt
      ? now < opensAt.getTime()
        ? "before"
        : now <= allocAt.getTime()
          ? "open"
          : "after"
      : null;
  const dayLabel = date === todayStr ? "" : ` de ${format(new Date(`${date}T00:00:00`), "dd/MM")}`;

  const waiting = tCheckins.filter((c) => c.status === "waiting_admin");
  const standbys = tCheckins.filter((c) => c.kind === "standby");
  const checkinOf = (shiftId: string) => tCheckins.find((c) => c.shift_id === shiftId);

  // resumo: quem já chegou, quem falta, quem faltou
  const confirmed = tShifts.filter((s) => isConfirmed(checkinOf(s.id)?.status)).length;
  const missed = tShifts.filter((s) => !checkinOf(s.id) && s.missed_at).length;
  const pending = tShifts.filter((s) => !checkinOf(s.id) && !s.missed_at).length;

  // pendentes primeiro, depois faltas, depois quem já chegou
  const rank = (s: any) => (checkinOf(s.id) ? 2 : s.missed_at ? 1 : 0);
  const shiftsOfSlot = (slotId: string | null) =>
    tShifts
      .filter((s) => (slotId ? s.slot_id === slotId : !tSlots.some((x) => x.id === s.slot_id)))
      .sort(
        (a, b) =>
          rank(a) - rank(b) || (a.broker?.full_name ?? "").localeCompare(b.broker?.full_name ?? ""),
      );
  const orphanShifts = shiftsOfSlot(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => {
            if (!e.target.value) return;
            setDate(e.target.value);
            setTurn("");
          }}
          className="h-10 px-3 rounded-lg bg-white border border-border text-sm"
        />
        {date !== todayStr && (
          <button
            type="button"
            onClick={() => {
              setDate(todayStr);
              setTurn("");
            }}
            className="h-10 px-3 rounded-lg bg-white border border-border text-sm font-medium text-[var(--navy)]"
          >
            Hoje
          </button>
        )}
        {turnOptions.length > 0 && (
          <div className="inline-flex flex-wrap rounded-lg border border-border bg-white p-0.5">
            {turnOptions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTurn(t)}
                aria-pressed={t === current}
                title={t.replace("-", "–")}
                className={`h-9 px-3 rounded-md text-sm font-medium ${t === current ? "bg-[var(--navy)] text-white" : "text-muted-foreground"}`}
              >
                {turnName(t) ?? t.replace("-", "–")}
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
          {/* Situação e resumo do turno */}
          <div
            className={`rounded-2xl border p-4 ${
              tState?.needs_admin
                ? "bg-orange-50 border-orange-200"
                : tState?.processed_at
                  ? "bg-green-50 border-green-200"
                  : "bg-white border-border"
            }`}
          >
            <div className="flex items-start gap-3">
              {tState?.needs_admin ? (
                <AlertTriangle className="text-orange-600 flex-shrink-0" size={20} />
              ) : tState?.processed_at ? (
                <CheckCircle2 className="text-green-600 flex-shrink-0" size={20} />
              ) : (
                <Clock className="text-muted-foreground flex-shrink-0" size={20} />
              )}
              <div className="text-sm min-w-0">
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
                    {phase === "before"
                      ? `Check-in ainda não abriu: abre às ${format(opensAt!, "HH:mm")}${dayLabel}.`
                      : phase === "open"
                        ? `Check-in aberto: a alocação acontece às ${format(allocAt!, "HH:mm")}.`
                        : phase === "after"
                          ? "Check-in encerrado; a alocação deste turno não foi registrada."
                          : "Turno sem horário de check-in definido."}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {turnName(current) ? `${turnName(current)} · ` : ""}
                  {current.replace("-", "–")}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Counter label="Confirmados" value={`${confirmed} de ${tShifts.length}`} tone="green" />
              <Counter label="Pendentes" value={pending} tone={pending > 0 ? "amber" : "muted"} />
              <Counter label="Faltas" value={missed} tone={missed > 0 ? "red" : "muted"} />
              <Counter label="Stand-by" value={standbys.length} tone="muted" />
            </div>
          </div>

          {/* Decisão manual: urgente, fica acima das listas */}
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

          {/* celular: uma coluna; computador: equipes à esquerda, stand-by e mapa à direita */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-3 items-start">
            <div className="space-y-3">
              {/* Cada equipe/local com suas vagas e seus escalados */}
              {tSlots.map((s) => {
                const occ = occupied(s.id);
                const open = Math.max(0, s.capacity - occ);
                const people = shiftsOfSlot(s.id);
                // stand-by que assumiu vaga aqui
                const allocated = tCheckins.filter(
                  (c) => c.kind === "standby" && c.slot_id === s.id && c.status === "allocated",
                );
                return (
                  <section key={s.id} className="bg-white rounded-2xl border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <h3 className="text-sm font-semibold text-[var(--navy)] inline-flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: teamColor(s.config?.manager_id) }}
                        />
                        <span className="truncate">
                          {teamName(s.config?.manager_id)} ·{" "}
                          {labels[locationOfModality(s.config?.modality)]}
                        </span>
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {occ} de {s.capacity} vaga{s.capacity === 1 ? "" : "s"} ocupada
                        {s.capacity === 1 ? "" : "s"}
                        {open > 0 && (
                          <span className="ml-2 font-semibold text-[var(--gold-dark)]">
                            {open} aberta{open === 1 ? "" : "s"}
                          </span>
                        )}
                      </p>
                    </div>
                    {people.length === 0 && allocated.length === 0 ? (
                      <p className="text-xs text-muted-foreground mt-2">Ninguém escalado aqui.</p>
                    ) : (
                      <ul className="divide-y divide-border mt-1">
                        {people.map((p) => (
                          <PersonRow
                            key={p.id}
                            name={p.broker?.full_name}
                            color={p.broker?.color}
                            avatarUrl={p.broker?.avatar_url}
                            checkin={checkinOf(p.id)}
                            missed={!!p.missed_at}
                          />
                        ))}
                        {allocated.map((c) => (
                          <PersonRow
                            key={c.id}
                            name={c.broker?.full_name}
                            color={c.broker?.color}
                            avatarUrl={c.broker?.avatar_url}
                            checkin={c}
                            missed={false}
                            note="veio do stand-by"
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
              {orphanShifts.length > 0 && (
                <section className="bg-white rounded-2xl border border-border p-4">
                  <h3 className="text-sm font-semibold text-[var(--navy)]">Escalados sem vaga</h3>
                  <ul className="divide-y divide-border mt-1">
                    {orphanShifts.map((p) => (
                      <PersonRow
                        key={p.id}
                        name={p.broker?.full_name}
                        color={p.broker?.color}
                        avatarUrl={p.broker?.avatar_url}
                        checkin={checkinOf(p.id)}
                        missed={!!p.missed_at}
                        note={teamName(p.broker?.manager_id)}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <div className="space-y-3">
              <section className="bg-white rounded-2xl border border-border p-4">
                <h3 className="text-sm font-semibold text-[var(--navy)] mb-1">
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

              {/* o mapa pesa: só carrega quando pedem */}
              {places.length > 0 && (
                <section className="bg-white rounded-2xl border border-border">
                  <button
                    type="button"
                    onClick={() => setMapOpen(!mapOpen)}
                    aria-expanded={mapOpen}
                    className="w-full h-12 px-4 flex items-center justify-between text-sm font-semibold text-[var(--navy)]"
                  >
                    <span>
                      Mapa dos check-ins
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {points.length} no mapa
                      </span>
                    </span>
                    <ChevronDown
                      size={16}
                      className={`transition-transform duration-200 ${mapOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {mapOpen && (
                    <div className="px-4 pb-4">
                      <LazyMap places={places} points={points} height={320} />
                    </div>
                  )}
                </section>
              )}
              {places.length === 0 && canDecide && (
                <p className="text-xs text-muted-foreground">
                  Defina a Central e o Plantão na aba "Regras" para ver o mapa e liberar os
                  check-ins.
                </p>
              )}
            </div>
          </div>
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

const COUNTER_TONE = {
  green: "text-green-700",
  amber: "text-amber-700",
  red: "text-red-700",
  muted: "text-[var(--navy)]",
} as const;

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: keyof typeof COUNTER_TONE;
}) {
  return (
    <div className="rounded-xl bg-white/70 border border-border px-3 py-2">
      <div className={`text-lg font-bold leading-tight tabular-nums ${COUNTER_TONE[tone]}`}>{value}</div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

function PersonRow({
  name,
  color,
  avatarUrl,
  checkin,
  missed,
  note,
}: {
  name?: string;
  color?: string;
  avatarUrl?: string | null;
  checkin?: any;
  missed: boolean;
  note?: string;
}) {
  const detail = [note, checkin && `check-in ${format(new Date(checkin.created_at), "HH:mm")}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="py-2 flex items-center gap-3 text-sm">
      <Avatar name={name ?? "?"} color={color ?? "#A8A8A8"} src={avatarUrl} size={32} />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[var(--navy)] truncate">{name}</div>
        {detail && <div className="text-[11px] text-muted-foreground">{detail}</div>}
      </div>
      {checkin ? (
        <StatusBadge status={checkin.status} />
      ) : missed ? (
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
            className="h-10 px-2 rounded-lg border border-border bg-white text-sm flex-1 min-w-[180px]"
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
            className="h-10 px-3 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold disabled:opacity-50"
          >
            Alocar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className="h-10 px-3 rounded-lg bg-[var(--surface)] text-[var(--navy)] text-sm font-medium disabled:opacity-50"
          >
            Deixar de fora
          </button>
        </div>
      )}
    </div>
  );
}
