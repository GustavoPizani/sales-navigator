import { useEffect, useState } from "react";
import { Copy, Download, Printer } from "lucide-react";
import toast from "react-hot-toast";
import { usePdvLabels } from "@/hooks/useRoulette";

/**
 * QR code do check-in: abre o app em /checkin?auto=1 e já inicia o check-in.
 * O mesmo código serve para os dois PDVs — o GPS do corretor é que valida o
 * local (por isso fotografar o QR não permite check-in de fora do PDV).
 */
export function CheckinQr() {
  const labels = usePdvLabels();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const link = typeof window !== "undefined" ? `${window.location.origin}/checkin?auto=1` : "";

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    // carregado só no navegador
    import("qrcode")
      .then((QRCode) =>
        QRCode.toDataURL(link, {
          width: 720,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#2D2D2D", light: "#FFFFFF" },
        }),
      )
      .then((url) => !cancelled && setDataUrl(url))
      .catch(() => toast.error("Não foi possível gerar o QR code."));
    return () => {
      cancelled = true;
    };
  }, [link]);

  const download = () => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "qr-checkin-roleta.png";
    a.click();
  };

  const print = () => {
    if (!dataUrl) return;
    const w = window.open("", "_blank", "width=720,height=960");
    if (!w) return toast.error("Permita pop-ups para imprimir o cartaz.");
    w.document
      .write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Check-in da roleta</title>
<link href="https://fonts.googleapis.com/css2?family=Titillium+Web:wght@300;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: "Titillium Web", sans-serif; color: #2D2D2D; text-align: center; margin: 0; }
  .brand { font-weight: 700; font-size: 34px; letter-spacing: .02em; margin-top: 8mm; }
  .sub { font-weight: 300; letter-spacing: .32em; text-transform: uppercase; color: #B28069; font-size: 15px; }
  .bar { width: 64px; height: 2px; background: #B28069; margin: 6mm auto 10mm; }
  h1 { font-size: 40px; margin: 0 0 3mm; }
  p { font-size: 18px; margin: 2mm 0; color: #646464; }
  img { width: 120mm; height: 120mm; margin: 8mm auto; display: block; border: 2px solid #E2E2E2; border-radius: 6mm; padding: 4mm; }
  .steps { text-align: left; display: inline-block; font-size: 17px; color: #2D2D2D; line-height: 1.7; }
  .foot { margin-top: 8mm; font-size: 13px; color: #989898; }
</style></head><body>
  <div class="brand">PAES &amp; GREGORI</div>
  <div class="sub">Gestão Comercial</div>
  <div class="bar"></div>
  <h1>Check-in da roleta</h1>
  <p>Aponte a câmera do celular para o código</p>
  <img src="${dataUrl}" alt="QR code do check-in">
  <div class="steps">
    1. Escaneie o código com a câmera.<br>
    2. Entre no app, se pedir.<br>
    3. Permita o acesso à localização.<br>
    4. Aguarde a confirmação do check-in.
  </div>
  <div class="foot">O check-in só é validado dentro do local (${labels.central} ou ${labels.plantao}).</div>
  <script>window.onload = () => setTimeout(() => window.print(), 400);</script>
</body></html>`);
    w.document.close();
  };

  return (
    <div className="bg-white rounded-2xl border border-border p-4">
      <h3 className="text-sm font-semibold text-[var(--navy)]">QR code do check-in</h3>
      <p className="text-xs text-muted-foreground mt-1">
        O corretor escaneia, o app abre e o check-in começa sozinho. A localização continua sendo
        conferida pelo GPS, então o código só funciona para quem está no PDV. O mesmo QR vale para{" "}
        {labels.central} e {labels.plantao}.
      </p>

      <div className="mt-4 flex flex-col sm:flex-row items-center gap-5">
        <div className="h-56 w-56 flex-shrink-0 rounded-2xl border border-border p-2 bg-white flex items-center justify-center">
          {dataUrl ? (
            <img src={dataUrl} alt="QR code do check-in da roleta" className="h-full w-full" />
          ) : (
            <span className="text-xs text-muted-foreground">Gerando…</span>
          )}
        </div>
        <div className="w-full space-y-2">
          <div className="rounded-xl bg-[var(--surface)] border border-border px-3 py-2 text-xs text-[var(--navy)] break-all font-mono">
            {link}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={print}
              disabled={!dataUrl}
              className="h-10 px-4 rounded-xl bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Printer size={15} /> Imprimir cartaz
            </button>
            <button
              type="button"
              onClick={download}
              disabled={!dataUrl}
              className="h-10 px-4 rounded-xl bg-white border border-border text-[var(--navy)] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Download size={15} /> Baixar imagem
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(link);
                toast.success("Link copiado!");
              }}
              className="h-10 px-4 rounded-xl bg-white border border-border text-[var(--navy)] text-sm font-semibold inline-flex items-center gap-2"
            >
              <Copy size={15} /> Copiar link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
