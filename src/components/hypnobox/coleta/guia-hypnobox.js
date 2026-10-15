/* Guia da coleta: roda dentro da página do Hypnobox quando você clica no favorito.
 * Só LÊ a tabela que já está desenhada na tela e manda para a aba da Coleta no
 * Sales Navigator (a que abriu esta janela). Não clica, não preenche, não consulta
 * nada por trás. O painel fica num shadow DOM para não mexer no visual da página.
 * __SN_ORIGEM__ é trocado pelo endereço do Sales Navigator ao montar o favorito. */
(function () {
  var ORIGEM = "__SN_ORIGEM__";
  // sobe a cada mudança no leitor: a Coleta avisa quando o favorito salvo é antigo
  var VERSAO = 2;
  var HYPNOBOX = "paesegregori.hypnobox.com.br";
  if (location.hostname !== HYPNOBOX) {
    alert("O Guia da coleta funciona nas páginas do Hypnobox (" + HYPNOBOX + ").");
    return;
  }
  if (window.__snGuia) {
    window.__snGuia.mostrar();
    return;
  }

  // ---------------- leitores (só leem o DOM já desenhado) ----------------
  var limpa = function (s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim();
  };
  var txt = function (el) {
    return el ? limpa(el.textContent) : "";
  };
  var ps = function (td) {
    return td ? Array.prototype.map.call(td.querySelectorAll("p"), txt).filter(Boolean) : [];
  };
  var arr = function (x) {
    return Array.prototype.slice.call(x || []);
  };

  function lerCabecalho() {
    var t = document.body ? document.body.innerText : "";
    var per = /(\d{2}\/\d{2}\/\d{4})\s*(?:à|a|até)\s*(\d{2}\/\d{2}\/\d{4})/i.exec(t);
    var tot = /total de\s*(\d[\d.]*)/i.exec(t);
    var el = document.querySelector("#displaytotalregistros, .displaytotalregistros");
    var num = function (s) {
      return s ? Number(String(s).replace(/\D/g, "")) || null : null;
    };
    var val = function (sel) {
      var e = document.querySelector(sel);
      return e ? limpa(e.value) : "";
    };
    return {
      periodoTela: per ? { de: per[1], ate: per[2] } : null,
      total: num(el && el.textContent) || num(tot && tot[1]),
      campos: {
        de: val('[name="de"]') || val('[name="mensagem_filtro_periodode"]'),
        ate: val('[name="ate"]') || val('[name="mensagem_filtro_periodoate"]'),
        tipoPeriodo: val('[name="visitas_filtro_tipo_periodo"]'),
      },
    };
  }

  function lerContatos() {
    var tabela = arr(document.querySelectorAll("table")).filter(function (t) {
      return /data de contato/i.test(t.innerText.slice(0, 400));
    })[0];
    if (!tabela) return null;
    var cab = arr(tabela.querySelectorAll("thead th, thead td")).map(function (th) {
      return limpa(th.innerText).toLowerCase();
    });
    var col = function (rx) {
      for (var i = 0; i < cab.length; i++) if (rx.test(cab[i])) return i;
      return -1;
    };
    var idx = {
      data: col(/data de contato/),
      atribuicao: col(/atribui/),
      cliente: col(/cliente/),
      origem: col(/origem/),
      canal: col(/canal|m[ií]dia/),
      duracao: col(/dura/),
      corretor: col(/corretor/),
      produto: col(/produto/),
    };
    var cortes = 0;
    var linhasDe = function (td) {
      if (!td) return [];
      var folhas = arr(td.querySelectorAll("*")).filter(function (e) {
        return !e.children.length && limpa(e.textContent);
      });
      var out = [];
      (folhas.length ? folhas : [td]).forEach(function (e) {
        var t = limpa(e.innerText || e.textContent);
        var titulo = limpa(
          e.getAttribute && (e.getAttribute("title") || e.getAttribute("data-original-title")),
        );
        var corta = /(\.\.\.|…)$/.test(t);
        if (corta && !titulo) cortes++;
        String(corta && titulo ? titulo : t)
          .split(/\n/)
          .forEach(function (p) {
            if (limpa(p)) out.push(limpa(p));
          });
      });
      return out;
    };
    var corpo = tabela.tBodies.length
      ? arr(tabela.tBodies).reduce(function (a, b) {
          return a.concat(arr(b.rows));
        }, [])
      : arr(tabela.rows).slice(1);
    return corpo
      .filter(function (tr) {
        return tr.cells.length >= 5;
      })
      .map(function (tr) {
        var td = arr(tr.cells);
        var html = tr.outerHTML;
        var id =
          /id_cliente[=:'"\s]+(\d{4,8})/i.exec(html) ||
          /data-(?:id|cliente)[^=]*=["'](\d{4,8})/i.exec(html) ||
          /\(\s*['"]?(\d{5,8})['"]?\s*[,)]/.exec(html);
        var pega = function (k) {
          return idx[k] >= 0 ? linhasDe(td[idx[k]]) : [];
        };
        cortes = 0;
        var l = {
          id_cliente: id ? id[1] : null,
          data: pega("data"),
          atribuicao: pega("atribuicao"),
          cliente: pega("cliente"),
          origem: pega("origem"),
          canal: pega("canal"),
          duracao: pega("duracao"),
          corretor: pega("corretor"),
          produto: pega("produto"),
        };
        l.cortados =
          cortes > 0 &&
          [l.cliente, l.canal].some(function (x) {
            return x.some(function (v) {
              return /(\.\.\.|…)$/.test(v);
            });
          });
        return l;
      });
  }

  // Linhas de uma célula como aparecem na tela (innerText respeita <br> e blocos).
  // Texto cortado ("...") é trocado pelo title do elemento, quando existe. A
  // etiqueta Cliente/Não cliente (.coluna) fica fora.
  function linhasDaCelula(td) {
    if (!td) return [];
    var tiraColuna = arr(td.querySelectorAll(".coluna")).map(function (e) {
      return limpa(e.innerText || e.textContent);
    });
    var linhas = String(td.innerText || td.textContent || "")
      .split(/\n/)
      .map(limpa)
      .filter(Boolean);
    tiraColuna.forEach(function (t) {
      var i = linhas.lastIndexOf(t);
      if (i >= 0) linhas.splice(i, 1);
    });
    return linhas.map(function (t) {
      if (!/(\.\.\.|…)$/.test(t)) return t;
      var base = t.replace(/\s*(\.\.\.|…)$/, "");
      var el = arr(td.querySelectorAll("[title], [data-original-title]")).filter(function (e) {
        return limpa(e.textContent).indexOf(base) === 0;
      })[0];
      var titulo = el && limpa(el.getAttribute("title") || el.getAttribute("data-original-title"));
      return titulo && titulo.indexOf(base) === 0 ? titulo : t;
    });
  }

  function lerClientes() {
    var psCli = linhasDaCelula;
    return arr(document.querySelectorAll("tbody tr"))
      .map(function (tr) {
        var chk = tr.querySelector('input[name="check_cliente_selecionado[]"]');
        if (!chk) return null;
        var td = arr(tr.children);
        return {
          id: chk.value,
          c1: psCli(td[1]),
          coluna: txt(td[1] && td[1].querySelector(".coluna")),
          c2: psCli(td[2]),
          c3: psCli(td[3]),
          c4: psCli(td[4]),
          c5: psCli(td[5]),
        };
      })
      .filter(Boolean);
  }
  function midiasMarcadas() {
    var sel = document.querySelector('select[name="media_filter[]"]');
    return sel ? arr(sel.selectedOptions).map(txt).filter(Boolean) : [];
  }

  function lerVisitas() {
    return arr(document.querySelectorAll("tbody tr"))
      .map(function (tr) {
        var id = /botaoDetalhesVisita\((\d+)\)/.exec(tr.innerHTML);
        if (!id) return null;
        var td = arr(tr.children);
        var ico = td[0] && td[0].querySelector("i");
        var cls = ico ? ico.className : "";
        var status = /nao-realizada/.test(cls)
          ? "Não realizada"
          : /realizada/.test(cls)
            ? "Realizada"
            : /agendada/.test(cls)
              ? "Agendada"
              : "";
        return {
          visita_id: id[1],
          status: status,
          c0: ps(td[0]),
          c1: ps(td[1]),
          c2: ps(td[2]),
          produto: txt(td[3]),
          c4: ps(td[4]),
        };
      })
      .filter(Boolean);
  }

  function lerMensagens() {
    return arr(document.querySelectorAll("tbody tr"))
      .filter(function (tr) {
        return tr.children.length > 6 && tr.querySelector(".ico-legenda, p");
      })
      .map(function (tr) {
        var td = arr(tr.children);
        var ico = tr.querySelector(".ico-legenda");
        var cls = ico ? ico.className : "";
        var status = /naolida|nao-lida/.test(cls)
          ? "nao_lida"
          : /respondida/.test(cls)
            ? "respondida"
            : /direcionada/.test(cls)
              ? "direcionada"
              : /lida/.test(cls)
                ? "lida"
                : "";
        return { status: status, c1: ps(td[1]), c2: ps(td[2]), c4: ps(td[4]), c6: ps(td[6]) };
      });
  }

  var PAGINAS = [
    {
      id: "contatos",
      rx: function (u) {
        return /controle=Relatorio/i.test(u) && /acao=contato/i.test(u);
      },
      ler: lerContatos,
    },
    {
      id: "clientes",
      rx: function (u) {
        return /controle=Cliente/i.test(u) && !/acao=timeline/i.test(u);
      },
      ler: lerClientes,
    },
    {
      id: "visitas",
      rx: function (u) {
        return /controle=Visita/i.test(u) && !/acao=detalhes/i.test(u);
      },
      ler: lerVisitas,
    },
    {
      id: "mensagens",
      rx: function (u) {
        return /controle=Mensagem/i.test(u);
      },
      ler: lerMensagens,
    },
  ];
  var aqui =
    PAGINAS.filter(function (p) {
      return p.rx(location.href);
    })[0] || null;

  // ---------------- canal com a aba da Coleta ----------------
  var sn = window.opener;
  var ligado = function () {
    try {
      return Boolean(sn && !sn.closed);
    } catch (e) {
      return false;
    }
  };
  var enviar = function (msg) {
    if (ligado()) sn.postMessage(Object.assign({ origem: "sn-guia", versao: VERSAO }, msg), ORIGEM);
  };
  var estado = null;
  var ultimaAssinatura = "";

  function escanear() {
    if (!aqui || document.querySelector('input[type="password"]')) return;
    var linhas;
    try {
      linhas = aqui.ler();
    } catch (e) {
      return;
    }
    if (!linhas) return;
    var leitura = { passo: aqui.id, url: location.href, cab: lerCabecalho(), linhas: linhas };
    if (aqui.id === "clientes") leitura.midias = midiasMarcadas();
    var assinatura = JSON.stringify(leitura);
    if (assinatura === ultimaAssinatura) return;
    ultimaAssinatura = assinatura;
    enviar({ tipo: "leitura", leitura: leitura });
  }

  // ---------------- painel ----------------
  var host = document.createElement("div");
  host.setAttribute("data-sn-guia", "");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  var raiz = host.attachShadow({ mode: "open" });
  raiz.innerHTML =
    "<style>" +
    ":host{all:initial}" +
    '*{box-sizing:border-box;font-family:"Titillium Web",-apple-system,"Segoe UI",Roboto,sans-serif}' +
    ".p{width:340px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#2D2D2D;border:1px solid #e5e5e5;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.22);font-size:14px;line-height:1.4}" +
    ".h{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#2D2D2D;color:#fff;border-radius:18px 18px 0 0;cursor:move;user-select:none}" +
    ".h b{flex:1;font-size:14px}.h small{color:#B28069;font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:10px;display:block}" +
    ".ic{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:8px;color:#fff;font-size:16px}.ic:hover{background:rgba(255,255,255,.15)}.ic:focus-visible{outline:2px solid #B28069}" +
    ".c{padding:14px;display:grid;gap:12px}" +
    ".ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d;border-radius:12px;padding:10px 12px}" +
    ".av{background:#fffbeb;border:1px solid #fde68a;color:#78350f;border-radius:12px;padding:10px 12px;font-size:13px}" +
    ".lido{background:#f0f9ff;color:#075985;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:600}" +
    ".t{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#737373}" +
    "ol{margin:0;padding:0;list-style:none;display:grid;gap:6px}" +
    ".st{display:flex;gap:8px;align-items:center;font-size:13px}.st .n{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;background:#F3F3F3;flex:none}" +
    ".st.feito .n{background:#16a34a;color:#fff}.st.atual{font-weight:700}.st.atual .n{background:#2D2D2D;color:#fff}.st .q{margin-left:auto;color:#737373;font-variant-numeric:tabular-nums;font-weight:400}" +
    ".ins{display:grid;gap:6px;margin:0;padding-left:18px}" +
    ".b{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:0 14px;border-radius:12px;font-weight:700;font-size:14px;text-align:center}" +
    ".b:focus-visible{outline:2px solid #B28069;outline-offset:2px}" +
    ".b1{background:#2D2D2D;color:#fff}.b1:hover{background:#000}.b2{background:#B28069;color:#2D2D2D}.b3{border:1px solid #e5e5e5;color:#2D2D2D}.b3:hover{background:#F3F3F3}" +
    ".lk{all:unset;cursor:pointer;color:#7E5845;font-size:12px;font-weight:700}.lk:hover{text-decoration:underline}" +
    ".mini{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;background:#2D2D2D;color:#fff;border-radius:999px;padding:10px 16px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.25)}" +
    ".bar{height:6px;border-radius:99px;background:#e0f2fe;overflow:hidden}.bar i{display:block;height:100%;background:#0ea5e9}" +
    "@media (prefers-reduced-motion:no-preference){.pulse{animation:p 1.4s ease-in-out infinite}@keyframes p{50%{opacity:.45}}}" +
    '</style><div id="r" role="dialog" aria-label="Guia da coleta"></div>';
  document.documentElement.appendChild(host);
  var r = raiz.getElementById("r");
  var minimizado = false;

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var fmt = function (n) {
    return Number(n || 0).toLocaleString("pt-BR");
  };

  function desenhar() {
    if (minimizado) {
      var atualM =
        estado &&
        estado.passos.filter(function (p) {
          return p.id === estado.passoAtual;
        })[0];
      r.innerHTML =
        '<button class="mini" id="abrir">Guia da coleta' +
        (atualM ? " · " + esc(atualM.titulo) : "") +
        "</button>";
      raiz.getElementById("abrir").onclick = function () {
        minimizado = false;
        desenhar();
      };
      return;
    }
    var h =
      '<div class="p"><div class="h" id="arrasta"><div style="flex:1"><small>Sales Navigator</small><b>Guia da coleta</b></div>' +
      '<button class="ic" id="min" aria-label="Minimizar">–</button><button class="ic" id="fechar" aria-label="Fechar">×</button></div><div class="c">';
    if (!ligado()) {
      h +=
        '<div class="av"><b>Esta janela não está ligada à Coleta.</b><br>Abra o Hypnobox pelo botão <b>Sincronizar</b> na página Coleta de dados do Sales Navigator e use o guia nessa janela.</div>';
    } else if (document.querySelector('input[type="password"]')) {
      h +=
        '<div class="av">Entre com o seu login. Depois de entrar, clique no favorito <b>Guia da coleta</b> de novo.</div>';
    } else if (!estado) {
      h += '<div class="lido pulse">Conectando com a Coleta…</div>';
    } else {
      var atual = estado.passos.filter(function (p) {
        return p.id === estado.passoAtual;
      })[0];
      var naTela =
        aqui &&
        estado.passos.filter(function (p) {
          return p.id === aqui.id;
        })[0];
      var ul = estado.ultimaLeitura;
      if (naTela && naTela.status === "ok") {
        h +=
          '<div class="ok"><b>✓ ' +
          esc(naTela.titulo) +
          ": escaneado</b> (" +
          fmt(naTela.contagem) +
          " registros)</div>";
      }
      if (naTela && naTela.status !== "ok") {
        h +=
          '<div class="lido pulse">' +
          esc(
            ul && ul.passo === naTela.id
              ? ul.texto
              : "Lendo esta página. Assim que a tabela aparecer, eu escaneio.",
          ) +
          "</div>";
        if (naTela.total)
          h +=
            '<div class="bar" aria-hidden="true"><i style="width:' +
            Math.max(3, Math.min(100, Math.round((naTela.contagem / naTela.total) * 100))) +
            '%"></i></div>';
        naTela.avisos.forEach(function (a) {
          h += '<div class="av">' + esc(a) + "</div>";
        });
      }
      if (atual) {
        h +=
          '<div><div class="t">' +
          (naTela && naTela.id === atual.id
            ? "O que fazer nesta página"
            : "Próxima página: " + esc(atual.titulo)) +
          "</div>" +
          '<ol class="ins" style="list-style:decimal;margin-top:6px">' +
          atual.instrucoes
            .map(function (t) {
              return "<li>" + esc(t) + "</li>";
            })
            .join("") +
          "</ol></div>";
        if (!naTela || naTela.id !== atual.id)
          h += '<button class="b b1" id="ir">Ir para ' + esc(atual.titulo) + " →</button>";
        else if (naTela.contagem > 0)
          h += '<button class="b b3" id="concluir">Já passei por todas as páginas</button>';
      } else {
        h +=
          '<div class="ok"><b>Tudo lido.</b> Volte para a aba da Coleta: a gravação no banco começa sozinha.</div>';
      }
      h +=
        '<div><div class="t">Roteiro</div><ol style="margin-top:6px">' +
        estado.passos
          .map(function (p, i) {
            var cls = p.status === "ok" ? "feito" : p.id === estado.passoAtual ? "atual" : "";
            return (
              '<li class="st ' +
              cls +
              '"><span class="n">' +
              (p.status === "ok" ? "✓" : i + 1) +
              "</span>" +
              esc(p.titulo) +
              '<span class="q">' +
              (p.contagem ? fmt(p.contagem) + (p.total ? " / " + fmt(p.total) : "") : "") +
              "</span></li>"
            );
          })
          .join("") +
        "</ol></div>";
      if (naTela && naTela.contagem > 0)
        h +=
          '<div style="text-align:right"><button class="lk" id="limpar">Apagar o que li aqui e ler de novo</button></div>';
    }
    h += "</div></div>";
    r.innerHTML = h;
    var on = function (id, fn) {
      var b = raiz.getElementById(id);
      if (b) b.onclick = fn;
    };
    on("min", function () {
      minimizado = true;
      desenhar();
    });
    on("fechar", function () {
      parar();
    });
    on("ir", function () {
      var a = estado.passos.filter(function (p) {
        return p.id === estado.passoAtual;
      })[0];
      if (a) location.href = a.url;
    });
    on("concluir", function () {
      enviar({ tipo: "concluir", passo: aqui.id });
    });
    on("limpar", function () {
      ultimaAssinatura = "";
      enviar({ tipo: "limpar", passo: aqui.id });
    });
    arrastar(raiz.getElementById("arrasta"));
  }

  function arrastar(alca) {
    if (!alca) return;
    alca.onpointerdown = function (ev) {
      if (ev.target.closest && ev.target.closest("button")) return;
      var box = host.getBoundingClientRect();
      var dx = ev.clientX - box.left,
        dy = ev.clientY - box.top;
      alca.setPointerCapture(ev.pointerId);
      alca.onpointermove = function (m) {
        host.style.left = Math.max(0, Math.min(innerWidth - box.width, m.clientX - dx)) + "px";
        host.style.top = Math.max(0, Math.min(innerHeight - 60, m.clientY - dy)) + "px";
        host.style.right = "auto";
        host.style.bottom = "auto";
      };
      alca.onpointerup = function () {
        alca.onpointermove = null;
      };
    };
  }

  function aoMensagem(ev) {
    if (ev.origin !== ORIGEM || !ev.data || ev.data.origem !== "sn-coleta") return;
    if (ev.data.tipo === "estado") {
      estado = ev.data.estado;
      desenhar();
    }
  }
  window.addEventListener("message", aoMensagem);

  // relê quando a tabela muda (filtro, página seguinte); o painel fica fora (shadow DOM)
  var espera = null;
  var obs = new MutationObserver(function (lista) {
    if (
      lista.every(function (m) {
        return m.target === host;
      })
    )
      return;
    clearTimeout(espera);
    espera = setTimeout(escanear, 900);
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  var vivo = setInterval(function () {
    if (!ligado()) desenhar();
  }, 5000);

  function parar() {
    obs.disconnect();
    clearInterval(vivo);
    clearTimeout(espera);
    window.removeEventListener("message", aoMensagem);
    host.remove();
    window.__snGuia = null;
  }
  window.__snGuia = {
    mostrar: function () {
      minimizado = false;
      desenhar();
    },
  };

  desenhar();
  enviar({ tipo: "ola", url: location.href, passo: aqui ? aqui.id : null });
  escanear();
})();
