import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Clock, Loader2, MapPinCheck } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  LOCATION_COLOR,
  STATUS_INFO,
  allocationTime,
  checkinOpensAt,
  closeLabel,
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

/** Tela de check-in do corretor. */
export function BrokerCheckin() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const settingsQ = useRouletteSettings();
  const labels = usePdvLabels();
  const cfg = settingsQ.data;
  const periods = useShiftPeriods();
  // O admin escolhe quais turnos exigem localização: se o turno com check-in
  // aberto agora não exige, o GPS nem é pedido.
  const gpsRequiredNow = () => {
    if (!cfg) return true;
    const now = Date.now();
    const day = format(new Date(), "yyyy-MM-dd");
    const open = periods.find(
      (p) =>
        now >= checkinOpensAt(day, p.start, cfg.checkin_open_before_min).getTime() &&
        now <= allocationTime(day, p.start, cfg.tolerance_min).getTime(),
    );
    return open ? (cfg[`${open.key}_require_gps`] ?? true) : true;
  };
  const today = format(new Date(), "yyyy-MM-dd");
  const [lastPos, setLastPos] = useState<{ lat: number; lng: number } | null>(null);
  // resultado do check-in feito agora (confirmação em destaque na tela)
  const [result, setResult] = useState<{
    kind: string;
    location: RouletteLocation;
    start_time: string;
    end_time: string;
  } | null>(null);

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
      setResult(r);
      qc.invalidateQueries({ queryKey: ["my-checkins"] });
      toast.success(
        r?.kind === "scheduled"
          ? `Check-in validado (${labels[r.location as RouletteLocation]}).`
          : `Você está em stand-by (${labels[r.location as RouletteLocation]}).`,
      );
    },
    onError: (e: any) => toast.error(e.message ?? "Não foi possível fazer o check-in."),
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

  const checkins = checkinsQ.data ?? [];
  const shifts = shiftsQ.data ?? [];

  return (
    <div className="space-y-3">
      <LocationPermission required={gpsRequiredNow()} />
      <div className="bg-white rounded-2xl border border-border p-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-[var(--gold)]/15 text-[var(--gold-dark)] flex items-center justify-center flex-shrink-0">
            <MapPinCheck size={20} />
          </div>
          <div>
            <h2 className="font-bold text-[var(--navy)]">Check-in da roleta</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Faça o check-in no local do seu turno (Central ou Plantão). Se não estiver escalado,
              você entra como stand-by e pode ocupar uma vaga aberta.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => checkin.mutate()}
          disabled={checkin.isPending}
          className="mt-4 w-full h-14 rounded-2xl bg-[var(--navy)] text-white font-bold text-base inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {checkin.isPending ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <MapPinCheck size={20} />
          )}
          {checkin.isPending ? "Verificando localização…" : "Fazer check-in"}
        </button>
        {cfg && (
          <p className="mt-2 text-[11px] text-center text-muted-foreground">
            O check-in abre {cfg.checkin_open_before_min} min antes do turno e fecha{" "}
            {closeLabel(cfg.tolerance_min)}.
          </p>
        )}
      </div>

      {result && (
        <div
          role="status"
          className={`rounded-2xl border p-4 flex items-start gap-3 ${
            result.kind === "scheduled"
              ? "bg-green-50 border-green-200"
              : "bg-amber-50 border-amber-200"
          }`}
        >
          {result.kind === "scheduled" ? (
            <CheckCircle2 className="text-green-600 flex-shrink-0" size={24} />
          ) : (
            <Clock className="text-amber-600 flex-shrink-0" size={24} />
          )}
          <div>
            <p
              className={`font-bold ${result.kind === "scheduled" ? "text-green-800" : "text-amber-800"}`}
            >
              {result.kind === "scheduled" ? "Check-in validado!" : "Você está em stand-by"}
            </p>
            <p className="text-sm text-[var(--navy)]">
              {result.kind === "scheduled"
                ? `Você está na roleta do turno ${hhmm(result.start_time)}–${hhmm(result.end_time)} (${labels[result.location]}).`
                : `Registrado em ${labels[result.location]}. Você será avisado quando as vagas forem alocadas.`}
            </p>
          </div>
        </div>
      )}

      {checkins.length > 0 && (
        <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--navy)]">Seus check-ins de hoje</h3>
          {checkins.map((c) => {
            const info = STATUS_INFO[c.status as CheckinStatus];
            return (
              <div key={c.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--navy)]">
                    {hhmm(c.start_time)}–{hhmm(c.end_time)} ·{" "}
                    {labels[c.location as RouletteLocation]}
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${info.className}`}
                  >
                    {info.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {STATUS_HINT[c.status as CheckinStatus]}
                  {c.status === "standby" && cfg && (
                    <>
                      {" "}
                      Alocação às{" "}
                      {format(
                        allocationTime(c.turn_date, c.start_time, cfg.tolerance_min),
                        "HH:mm",
                      )}
                      .
                    </>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Check-in às {format(new Date(c.created_at), "HH:mm")}
                  {c.distance_m != null && ` · ${c.distance_m} m do local`}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-border p-4">
        <h3 className="text-sm font-semibold text-[var(--navy)] mb-2">Sua escala hoje</h3>
        {shifts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Você não está escalado hoje. Se estiver na Central ou no Plantão, faça o check-in como
            stand-by.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {shifts.map((s) => {
              const loc = locationOfModality(s.slot?.config?.modality);
              const done = checkins.find((c) => c.shift_id === s.id);
              return (
                <li key={s.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium text-[var(--navy)]">
                      {hhmm(s.start_time)}–{hhmm(s.end_time)} · {labels[loc]}
                    </div>
                    {cfg && !done && !s.missed_at && (
                      <div className="text-[11px] text-muted-foreground">
                        Check-in das{" "}
                        {format(
                          checkinOpensAt(s.date, s.start_time, cfg.checkin_open_before_min),
                          "HH:mm",
                        )}{" "}
                        às{" "}
                        {format(allocationTime(s.date, s.start_time, cfg.tolerance_min), "HH:mm")}
                      </div>
                    )}
                  </div>
                  {done ? (
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_INFO[done.status as CheckinStatus].className}`}
                    >
                      {STATUS_INFO[done.status as CheckinStatus].label}
                    </span>
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
      </div>

      {places.length > 0 && (
        <div className="bg-white rounded-2xl border border-border p-4">
          <h3 className="text-sm font-semibold text-[var(--navy)] mb-2">Locais de check-in</h3>
          <LazyMap
            places={places}
            points={
              lastPos
                ? [
                    {
                      id: "me",
                      lat: lastPos.lat,
                      lng: lastPos.lng,
                      color: "#2563EB",
                      label: "Você",
                    },
                  ]
                : []
            }
            height={260}
          />
        </div>
      )}
    </div>
  );
}
