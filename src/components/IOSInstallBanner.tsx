import { useEffect, useState } from "react";
import { X, Share } from "lucide-react";

const KEY = "gc_ios_install_dismissed_v1";

export function IOSInstallBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    const dismissed = localStorage.getItem(KEY);
    if (isIOS && !isStandalone && !dismissed) setShow(true);
  }, []);
  if (!show) return null;
  return (
    <div className="fixed top-2 inset-x-2 z-50 rounded-xl bg-[var(--navy)] text-white p-3 shadow-lg flex items-start gap-3">
      <div className="flex-1 text-sm">
        <p className="font-semibold mb-1">Install Gestão Comercial</p>
        <p className="text-white/80 text-xs">
          Tap <Share size={14} className="inline -mt-0.5" /> then "Add to Home Screen" for the full app experience.
        </p>
      </div>
      <button
        onClick={() => { localStorage.setItem(KEY, "1"); setShow(false); }}
        className="text-white/70 hover:text-white"
        aria-label="Dismiss"
      ><X size={18} /></button>
    </div>
  );
}
