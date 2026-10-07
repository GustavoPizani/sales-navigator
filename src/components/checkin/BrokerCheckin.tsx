import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Loader2, MapPinCheck } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  LOCATION_COLOR,
  STATUS_INFO,
  allocationTime,
  checkinOpensAt,
  getPosition,
  hhmm,
  locationOfModality,
  usePdvLabels,
  useRouletteSettings,
  useShiftPeriods,
  type CheckinStatus,
  type RouletteLocation,
} from "@/hooks/useRoulette";
import { LazyMap, type MapPlace } from "./LazyMap";
import { LocationPermission } from "./LocationPermission";

const STATUS_HINT: Record<CheckinStatus, string> = {
  validated: "Presença confirmada: você está na roleta neste turno.",
  allocated: "Vaga confirmada: você está na roleta neste turno.",
  standby: "Você está em stand-by. A alocação acontece quando o check-in fecha.",
  waiting_admin: "Há mais stand-by do que vagas. O administrador vai decidir.",
  not_allocated: "Você ficou fora da roleta neste turno.",
};

/** "em 12 min" quando falta menos de uma hora; senão, só o horário. */
function untilLabel(target: Date, now: number) {
  const min = Math.ceil((target.getTime() - now) / 60_000);
  return min > 0 && min < 60 ? `em ${min} min` : `às ${format(target, "HH:mm")}`;
}

/** Tela de check-in do corretor. */
export function BrokerCheckin() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const settingsQ = useRouletteSettings();
  const labels = usePdvLabels();
  const cfg = settingsQ.data;
  const periods = useShiftPeriods();
  // relógio da tela: o cartão principal muda sozinho quando o check-in abre ou fecha
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const today = format(new Date(now), "yyyy-MM-dd");
  const [lastPos, setLastPos] = useState<{ lat: number; lng: number } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  const shiftsQ = useQuery({
    queryKey: ["my-shifts-today", user?.id, today],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select(
          "id,date,start_time,end_time,slot_id,missed_at, slot:shift_slots(config:shift_configs(modality))",
        )
        .eq("broker_id", user!.id)
        .eq("date", today)
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const checkinsQ = useQuery({
    queryKey: ["my-checkins", user?.id, today],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roulette_checkins")
        .select("*")
        .eq("broker_id", user!.id)
        .eq("turn_date", today)
        .order("start_time");
      if (error) throw error;
      return data ?? [];
    },
  });

  const checkins = checkinsQ.data ?? [];
  const shifts = shiftsQ.data ?? [];

  // Turnos do dia (os 3 das regras, mais algum turno escalado fora deles), com a
  // janela de check-in de cada um.
  const turns = [
    ...periods.map((p) => ({ start: p.start, end: p.end })),
    ...shifts
      .map((s) => ({ start: hhmm(s.start_time), end: hhmm(s.end_time) }))
      .filter((s) => !periods.some((p) => p.start === s.start)),
  ]
    .map((t) => ({
      ...t,
      opens: cfg ? checkinOpensAt(today, t.start, cfg.checkin_open_before_min) : null,
      closes: cfg ? allocationTime(today, t.start, cfg.tolerance_min) : null,
      endsAt: new Date(`${today}T${t.end}:00`),
      shift: shifts.find((s) => hhmm(s.start_time) === t.start && !s.missed_at),
      checkin: checkins.find((c) => hhmm(c.start_time) === t.start),
    }))
    .sort((a, b) => a.start.localeCompare(b.start));

  const openTurn = turns.find(
    (t) => t.opens && t.closes && now >= t.opens.getTime() && now <= t.closes.getTime(),
  );
  // check-in já feito num turno que ainda não terminou
  const doneTurn = turns.find((t) => t.checkin && now <= t.endsAt.getTime());
  // próximo check-in a abrir: o do meu turno escalado, se houver; senão, o próximo do dia
  const upcoming = turns.filter((t) => t.opens && now < t.opens.getTime() && !t.checkin);
  const nextTurn = upcoming.find((t) => t.shift) ?? upcoming[0];

  const phase: "done" | "open" | "before" | "closed" | "loading" = !cfg
    ? "loading"
    : openTurn && !openTurn.checkin
      ? "open"
      : doneTurn
        ? "done"
        : nextTurn
          ? "before"
          : "closed";

  // O admin escolhe quais turnos exigem localização: se o turno com check-in
  // aberto agora não exige, o GPS nem é pedido.
  const gpsRequiredNow = () => {
    if (!cfg || !openTurn) return true;
    const period = periods.find((p) => p.start === openTurn.start);
    return period ? (cfg[`${period.key}_require_gps`] ?? true) : true;
  };

  const checkin = useMutation({
    mutationFn: async () => {
      const pos = gpsRequiredNow() ? await getPosition() : null;
      if (pos) setLastPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      const { data, error } = await supabase.rpc("crm_roulette_checkin", {
        p_lat: pos?.coords.latitude ?? null,
        p_lng: pos?.coords.longitude ?? null,
        p_accuracy: pos?.coords.accuracy ?? null,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["my-checkins"] });
      toast.success(
        r?.kind === "scheduled"
          ? `Check-in validado (${labels[r.location as RouletteLocation]}).`
          : `Você está em stand-by (${labels[r.location as RouletteLocation]}).`,
      );
    },
    // o erro fica na tela (cartão principal), não num aviso que some
  });

  // Chegou pelo QR code (/checkin?auto=1): inicia o check-in sozinho, uma vez.
  // O GPS continua validando o local — o QR é só o atalho.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("auto") !== "1") return;
    autoStarted.current = true;
    params.delete("auto");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    checkin.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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

  // Lista única do dia: meus turnos escalados e os check-ins feitos como stand-by.
  const rows = [
    ...shifts.map((s) => ({
      key: `s-${s.id}`,
      start: hhmm(s.start_time),
      end: hhmm(s.end_time),
      location: locationOfModality(s.slot?.config?.modality),
      shift: s,
      checkin: checkins.find((c) => c.shift_id === s.id),
    })),
    ...checkins
      .filter((c) => !shifts.some((s) => s.id === c.shift_id))
      .map((c) => ({
        key: `c-${c.id}`,
        start: hhmm(c.start_time),
        end: hhmm(c.end_time),
        location: c.location as RouletteLocation,
        shift: null as any,
        checkin: c,
      })),
  ].sort((a, b) => a.start.localeCompare(b.start));

  const done = doneTurn?.checkin;
  const doneInfo = done ? STATUS_INFO[done.status as CheckinStatus] : null;
  const doneOk = done?.status === "validated" || done?.status === "allocated";

  return (
    <div className="space-y-3">
      <LocationPermission required={gpsRequiredNow()} />

      {/* Cartão principal: responde "posso fazer check-in agora?" */}
      <div className="bg-white rounded-2xl border border-border p-4">
        {phase === "done" && done && doneInfo ? (
          <div
            role="status"
            className={`rounded-2xl border p-4 flex items-start gap-3 ${
              doneOk
                ? "bg-green-50 border-green-200"
                : done.status === "not_allocated"
                  ? "bg-[var(--surface)] border-border"
                  : "bg-amber-50 border-amber-200"
            }`}
          >
            {doneOk ? (
              <CheckCircle2 className="text-green-600 flex-shrink-0" size={28} />
            ) : (
              <Clock className="text-amber-600 flex-shrink-0" size={28} />
            )}
            <div>
              <p className="font-bold text-[var(--navy)]">
                {doneOk ? "Check-in feito" : doneInfo.label} · {hhmm(done.start_time)}–
                {hhmm(done.end_time)}
              </p>
              <p className="text-sm text-[var(--navy)] mt-0.5">
                {STATUS_HINT[done.status as CheckinStatus]}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {labels[done.location as RouletteLocation]} · check-in às{" "}
                {format(new Date(done.created_at), "HH:mm")}
                {done.distance_m != null && ` · ${done.distance_m} m do local`}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-[var(--gold)]/15 text-[var(--gold-dark)] flex items-center justify-center flex-shrink-0">
                <MapPinCheck size={20} />
              </div>
              <div>
                <h2 className="font-bold text-[var(--navy)]">
                  {phase === "open" && openTurn
                    ? `Check-in aberto · turno ${openTurn.start}–${openTurn.end}`
                    : phase === "before" && nextTurn
                      ? `Check-in abre ${untilLabel(nextTurn.opens!, now)}`
                      : phase === "closed"
                        ? "Check-ins de hoje encerrados"
                        : "Check-in da roleta"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {phase === "open" && openTurn
                    ? `${
                        openTurn.shift
                          ? `Você está escalado em ${labels[locationOfModality(openTurn.shift.slot?.config?.modality)]}.`
                          : "Você não está escalado neste turno: entra como stand-by e pode ocupar uma vaga aberta."
                      } Fecha às ${format(openTurn.closes!, "HH:mm")}.`
                    : phase === "before" && nextTurn
                      ? `Turno ${nextTurn.start}–${nextTurn.end}${
                          nextTurn.shift ? ", em que você está escalado" : " (como stand-by)"
                        }. O check-in vai das ${format(nextTurn.opens!, "HH:mm")} às ${format(nextTurn.closes!, "HH:mm")}.`
                      : phase === "closed"
                        ? "Não há mais check-in para abrir hoje."
                        : "Carregando os horários…"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => checkin.mutate()}
              disabled={checkin.isPending || phase !== "open"}
              className="mt-4 w-full h-14 rounded-2xl bg-[var(--navy)] text-white font-bold text-base inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {checkin.isPending ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <MapPinCheck size={20} />
              )}
              {checkin.isPending
                ? "Verificando localização…"
                : phase === "open"
                  ? "Fazer check-in"
                  : phase === "before" && nextTurn
                    ? `Abre às ${format(nextTurn.opens!, "HH:mm")}`
                    : "Check-in fechado"}
            </button>
          </>
        )}

        {checkin.isError && (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 flex items-start gap-2 text-sm text-red-700"
          >
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>
              {(checkin.error as Error)?.message ?? "Não foi possível fazer o check-in."}
            </span>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-border p-4">
        <h3 className="text-sm font-semibold text-[var(--navy)] mb-2">Seus turnos de hoje</h3>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Você não está escalado hoje. Se estiver na Central ou no Plantão, faça o check-in como
            stand-by.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const c = r.checkin;
              return (
                <li key={r.key} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[var(--navy)]">
                      {r.start}–{r.end} · {labels[r.location]}
                    </span>
                    {c ? (
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_INFO[c.status as CheckinStatus].className}`}
                      >
                        {STATUS_INFO[c.status as CheckinStatus].label}
                      </span>
                    ) : r.shift?.missed_at ? (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                        Falta
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--surface)] text-muted-foreground">
                        Pendente
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {c ? (
                      <>
                        Check-in às {format(new Date(c.created_at), "HH:mm")}
                        {c.distance_m != null && ` · ${c.distance_m} m do local`}
                        {c.status === "standby" &&
                          cfg &&
                          ` · alocação às ${format(allocationTime(c.turn_date, c.start_time, cfg.tolerance_min), "HH:mm")}`}
                      </>
                    ) : r.shift?.missed_at ? (
                      "O check-in não foi feito no prazo."
                    ) : cfg ? (
                      <>
                        Check-in das{" "}
                        {format(
                          checkinOpensAt(r.shift.date, r.shift.start_time, cfg.checkin_open_before_min),
                          "HH:mm",
                        )}{" "}
                        às{" "}
                        {format(
                          allocationTime(r.shift.date, r.shift.start_time, cfg.tolerance_min),
                          "HH:mm",
                        )}
                      </>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* o mapa pesa: só carrega quando o corretor pede */}
      {places.length > 0 && (
        <div className="bg-white rounded-2xl border border-border">
          <button
            type="button"
            onClick={() => setMapOpen(!mapOpen)}
            aria-expanded={mapOpen}
            className="w-full h-12 px-4 flex items-center justify-between text-sm font-semibold text-[var(--navy)]"
          >
            Locais de check-in no mapa
            <ChevronDown
              size={16}
              className={`transition-transform duration-200 ${mapOpen ? "rotate-180" : ""}`}
            />
          </button>
          {mapOpen && (
            <div className="px-4 pb-4">
              <LazyMap
                places={places}
                points={
                  lastPos
                    ? [{ id: "me", lat: lastPos.lat, lng: lastPos.lng, color: "#2563EB", label: "Você" }]
                    : []
                }
                height={260}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
