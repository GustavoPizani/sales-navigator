// Content script nas páginas do Gestão Comercial: avisa a extensão de qual conta
// está logada no sistema neste navegador, para a faixa do WhatsApp entrar sozinha.
// Lê só o token de acesso atual (vale 1 hora); a extensão troca por uma sessão própria.
(() => {
  function avisar() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^sb-.+-auth-token$/.test(k)) continue;
        const s = JSON.parse(localStorage.getItem(k) || "null");
        if (!s?.access_token || !s.expires_at) continue;
        chrome.storage.local.set({
          tokenSistema: {
            servidor: location.origin,
            access_token: s.access_token,
            expira: s.expires_at * 1000,
            email: s.user?.email || "",
          },
        });
        return;
      }
      // saiu do sistema: esquece o login deste servidor
      chrome.storage.local.get("tokenSistema", (v) => {
        if (v.tokenSistema?.servidor === location.origin) chrome.storage.local.remove("tokenSistema");
      });
    } catch {
      /* sem acesso ao armazenamento */
    }
  }
  avisar();
  setInterval(avisar, 30000);
})();
