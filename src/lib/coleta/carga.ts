/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck -- regras portadas do extrator (testadas com o Hypnobox falso); os tipos ficam em montarCargaGuiada
/**
 * Monta as tabelas al_* a partir do que foi lido nas telas do Hypnobox e do dash
 * da LEN. A gravação é do servidor (al_sincronizar): leads e visitas são
 * sincronizados (atualiza os que existem, insere os novos); os resumos são trocados.
 */
import * as R from "./regras";

const brIso = (s) => R.dataBR(s);
/** Valor da tela só se não veio cortado ("..."). */
const inteiro = (s) => {
  const v = R.semTraco(s);
  return v && !/(\.\.\.|…)$/.test(v) ? v : null;
};

/** Canais dos clientes que não vieram da LEN (orgânico e carteira do corretor). */
export const CANAIS_FORA_LEN = ["Orgânico", "Carteira do corretor"];

/** Origem do cliente pela mídia e pelas linhas de canal (relatório de contatos e ficha). */
function grupoDoCliente(midia, linhas) {
  const tudo = [midia, ...(linhas || [])].filter(Boolean).join(" | ");
  if (/len/i.test(midia || "")) return "len";
  if (/carteira|indica|an[uú]ncio corretor/i.test(tudo)) return "carteira";
  if (/org[aâ]nic|acesso direto/i.test(tudo)) return "organico";
  return null;
}

const TABELAS_HYPNOBOX = [
  "al_leads",
  "al_visitas",
  "al_mensagens_corretor",
  "al_mensagens_horario",
];
const TABELAS_LEN = [
  "al_funil_produto",
  "al_status_geral",
  "al_fontes",
  "al_descarte",
  "al_veiculo",
  "al_mkt_campanhas",
  "al_mkt_diario",
  "al_mkt_anuncios",
  "al_mkt_palavras",
];

// Referência da coleta de 14/10/2026: contagens muito diferentes são sinalizadas.
const REFERENCIA = {
  leads: 596,
  visitas: 66,
  mensagens: 466,
  campanhas: 333,
  investimento: 128700,
};

const FAIXAS = [
  ["00h–08h", 0, 8],
  ["08h–12h", 8, 12],
  ["12h–18h", 12, 18],
  ["18h–22h", 18, 22],
  ["22h–24h", 22, 24],
];

/** "NOME (Corretor)" -> "NOME (corretor)"; "Supervisor X (Recepção Salão)" -> "Supervisor X (recepção)". */
function quemRegistrou(criadoPor) {
  const s = R.limpa(criadoPor);
  if (/\(recep/i.test(s)) return s.replace(/\(([^)]*)\)\s*$/, "(recepção)");
  return s.replace(/\(([^)]*)\)\s*$/, (_, x) => `(${x.toLowerCase()})`);
}

function montarLeads(clientes, dataColeta) {
  return clientes.map((c) => {
    const [nome = "", email = "", tel = ""] = c.c1.map(R.semTraco);
    const cadastro = R.dataBR(c.c2[1]);
    const atualizacao = R.dataBR(c.c2[3]) || cadastro;
    const momento = R.semTraco(c.c5[0]);
    const submomento = R.semTraco(c.c5[1]) || "(vazio)";
    const canalContato = R.semTraco(c.c4[1]) || "Não preenchido";
    const subcanal = R.semTraco(c.c4[2]) || "Não preenchido";
    // lead já existente cuja mídia não apareceu nesta coleta: canal e campanha
    // vão vazios e o banco mantém os que já estavam gravados
    const camp = c._semMidia
      ? { canal: null, campanha: null, palavra_chave: null }
      : c._camp || R.campanhaDaMidia(c.midia);
    return {
      id_cliente: c.id,
      cadastro,
      atualizacao,
      produto: R.semTraco(c.c4[0]),
      corretor: R.semTraco(c.c3[0]),
      gerente: R.semTraco(c.c3[1]),
      momento,
      submomento,
      etapa: R.etapa(momento, submomento),
      canal: camp.canal,
      campanha: camp.campanha,
      palavra_chave: camp.palavra_chave,
      origem: `${canalContato} / ${subcanal}`,
      status_cliente: /n[ãa]o/i.test(c.coluna) ? "Não cliente" : "Cliente",
      dias_desde_cadastro: R.diasEntre(cadastro, dataColeta),
      dias_sem_atualizar: R.diasEntre(atualizacao, dataColeta),
      // texto cortado na tela ("fulano@ya...") não vai para o banco: fica o que já estava
      nome: nome && !cortado(nome) ? nome : null,
      email: email && !cortado(email) ? R.normalizaEmail(email) : null,
      telefone: R.normalizaTelefone(tel) || null,
      telefone_original: tel || null,
      // auxiliares (não vão para o banco)
      _midia: c.midia,
      _extra: Boolean(c._camp),
      _fora: Boolean(c._fora),
      _canalContato: canalContato,
    };
  });
}

function montarVisitas(brutas, { idCliente, origem }, leadsPeriodo, todosLen) {
  const porId = new Map(leadsPeriodo.map((l) => [l.id_cliente, l]));
  const lenPorId = new Map(todosLen.map((c) => [c.id, c]));
  const unicas = new Map();
  for (const v of brutas) if (!unicas.has(v.visita_id)) unicas.set(v.visita_id, v);
  return [...unicas.values()].map((v) => {
    const id = idCliente[v.visita_id] || null;
    const lead = id ? porId.get(id) : null;
    const len = id ? lenPorId.get(id) : null;
    const dataTxt = v.c0.find((t) => /\d{1,2}\/[A-Za-z]{3}\/\d{4}|\d{2}\/\d{2}\/\d{4}/.test(t));
    const horaTxt = v.c0.find((t) => /\d{1,2}:\d{2}/.test(t));
    const data = R.dataEN(dataTxt);
    const gerente = (v.c1.find((t) => /^gerente:/i.test(t)) || "").replace(/^gerente:\s*/i, "");
    const criadoPor = v.c1.length ? v.c1[v.c1.length - 1] : "";
    const midia = len ? len.midia : (id && origem[id] && origem[id].midia) || "";
    const canalOrigem = len
      ? R.semTraco(len.c4[1]) || "Não preenchido"
      : (id && origem[id] && origem[id].canal) || null;
    return {
      visita_id: v.visita_id,
      id_cliente: id,
      data,
      hora: R.hora(horaTxt),
      status: v.status,
      corretor: R.semTraco(v.c1[0]),
      gerente: R.limpa(gerente),
      registrado_por: /\(recep/i.test(criadoPor) ? "Recepção do salão" : "Corretor",
      quem_registrou: quemRegistrou(criadoPor),
      produto: R.limpa(v.produto),
      temperatura: R.semTraco(v.c4[0]) || null,
      submomento: R.semTraco(v.c4[1]) || "(vazio)",
      origem: midia || null,
      grupo_origem: R.grupoOrigem(midia),
      canal_origem: canalOrigem,
      lead_campanha_periodo: Boolean(lead),
      cadastro_lead: lead ? lead.cadastro : null,
      dias_cadastro_ate_visita: lead ? R.diasEntre(lead.cadastro, data) : null,
      etapa_no_crm: lead ? lead.etapa : null,
      nome_cliente: inteiro(v.c2[0]),
      email_cliente: inteiro(v.c2[1]) ? R.normalizaEmail(inteiro(v.c2[1])) : null,
    };
  });
}

/** Código curto e estável para a chave da mensagem (o contato do cliente não vai para o banco). */
function codigo(texto) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Mensagens uma a uma (data, hora, corretor, status e mídia). O banco soma com
 * as já guardadas e recalcula os totais por corretor e por horário.
 */
function montarMensagens(mensagens) {
  return {
    al_mensagens: mensagens.map((m) => {
      const juntos = m.c1.join(" ");
      const h = /(\d{1,2}):(\d{2})/.exec(juntos);
      return {
        chave: codigo([m.c1.join("|"), m.c2.join("|"), m.c4.join("|")].join("#")),
        data: R.dataBR(juntos),
        hora: h ? `${h[1].padStart(2, "0")}:${h[2]}` : null,
        corretor: R.semTraco(m.c2[0]) || "(sem corretor)",
        status: m.status || null,
        midia: m.midia || null,
      };
    }),
  };
}

/** Completa e-mail e telefone vazios dos leads com visitas e mensagens (a ficha de Clientes manda). */
function completarContatos(leads, visitas, mensagens) {
  const porId = new Map(leads.map((l) => [l.id_cliente, l]));
  for (const v of visitas) {
    const l = v.id_cliente && porId.get(v.id_cliente);
    if (!l) continue;
    if (!l.email && v.email_cliente) l.email = v.email_cliente;
    if (!l.nome && v.nome_cliente) l.nome = v.nome_cliente;
  }
  const porEmail = new Map(leads.filter((l) => l.email).map((l) => [l.email, l]));
  const porTel = new Map(leads.filter((l) => l.telefone).map((l) => [l.telefone, l]));
  for (const m of mensagens) {
    const [nome = "", email = "", ...tels] = m.c4.map(R.semTraco);
    const em = R.normalizaEmail(email);
    const telOriginal = tels.filter(Boolean).join(" ");
    const tel = R.normalizaTelefone(
      tels
        .filter(Boolean)
        .sort((a, b) => b.replace(/\D/g, "").length - a.replace(/\D/g, "").length)[0],
    );
    const l = (em && porEmail.get(em)) || (tel && porTel.get(tel));
    if (!l) continue;
    if (!l.email && em) l.email = em;
    if (!l.telefone && tel) {
      l.telefone = tel;
      l.telefone_original = telOriginal;
    }
    if (!l.nome && nome) l.nome = nome;
  }
}

const semAuxiliares = (rows) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_"))));

/**
 * Junta tudo que já foi coletado. Só entram as tabelas cujas fontes foram lidas:
 * coletar só a LEN não apaga os dados do Hypnobox (e vice-versa).
 */
export function montarCarga(dados, { dataColeta, periodo }) {
  const tabelas = {};
  const fontes = [];
  if (dados.clientes) {
    const leads = montarLeads(dados.clientes.clientes, dataColeta);
    let visitas = [];
    if (dados.visitas && dados.detalhes)
      // a visita conta como "lead da campanha" só para os leads LEN
      visitas = montarVisitas(
        dados.visitas,
        dados.detalhes,
        leads.filter((l) => !l._extra && !l._fora),
        dados.clientes.todos,
      );
    const msgs = dados.mensagens ? dados.mensagens.mensagens : [];
    completarContatos(leads, visitas, msgs);
    tabelas.al_leads = semAuxiliares(leads);
    fontes.push("Clientes");
    if (dados.visitas && dados.detalhes) {
      tabelas.al_visitas = visitas;
      fontes.push("Visitas");
    }
    if (dados.mensagens) {
      Object.assign(tabelas, montarMensagens(msgs));
      fontes.push("Mensagens");
    }
  }
  if (dados.len) {
    for (const t of TABELAS_LEN) tabelas[t] = dados.len.tabelas[t] || [];
    fontes.push("dash da LEN");
  }
  const coleta = {
    periodo_inicio: periodo.de,
    periodo_fim: periodo.ate,
    fontes: fontes.length
      ? `Hypnobox (${fontes.filter((f) => f !== "dash da LEN").join(", ") || "—"})${dados.len ? " e dash da LEN (Números Gerais, Leads CRM, páginas por produto, Facebook Ads, Google Ads)" : ""}`
      : "",
    observacao: `Coleta de ${R.isoParaBR(dataColeta)} pela Central de coleta. Clientes: mídias com "len", cadastro de ${R.isoParaBR(periodo.de)} a ${R.isoParaBR(periodo.ate)}.${dados.len ? ` Campanhas em 4 janelas: ${dados.len.resumo.janelas.map((j) => `${j.janela} (${R.isoParaBR(j.de).slice(0, 5)}-${R.isoParaBR(j.ate).slice(0, 5)})`).join(", ")}.` : ""}`,
  };
  return { tabelas, coleta, checagens: checar(tabelas, dados) };
}

function checar(tabelas, dados) {
  const itens = [];
  const add = (nome, valor, ref, fmt = (n) => n.toLocaleString("pt-BR")) => {
    if (valor == null) return;
    const desvio = ref ? Math.abs(valor - ref) / ref : 0;
    itens.push({
      nome,
      valor,
      referencia: ref,
      texto: fmt(valor),
      referenciaTexto: fmt(ref),
      alerta: desvio > 0.25,
    });
  };
  if (tabelas.al_leads) {
    const extras = tabelas.al_leads.filter((l) => CANAIS_FORA_LEN.includes(l.canal)).length;
    add("Leads LEN", tabelas.al_leads.length - extras, REFERENCIA.leads);
    if (extras)
      itens.push({
        nome: "Orgânicos e carteira (corretores com leads LEN)",
        valor: extras,
        referencia: 0,
        texto: extras.toLocaleString("pt-BR"),
        referenciaTexto: "—",
        alerta: false,
      });
  }
  if (tabelas.al_visitas) add("Visitas", tabelas.al_visitas.length, REFERENCIA.visitas);
  if (dados.mensagens) add("Mensagens LEN", dados.mensagens.mensagens.length, REFERENCIA.mensagens);
  if (tabelas.al_mkt_campanhas)
    add("Linhas de campanhas", tabelas.al_mkt_campanhas.length, REFERENCIA.campanhas);
  if (dados.len)
    add(
      "Investimento no período",
      dados.len.resumo.investimentoPeriodo,
      REFERENCIA.investimento,
      (n) => "R$ " + (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil",
    );
  return itens;
}

// ---------------- cruzamentos (relatório de contatos x clientes x visitas) ----------------

const soDigitos = (s) => String(s || "").replace(/\D/g, "");
const chaveNome = (s) => R.limpa(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const ehEmail = (s) => /@/.test(s);
const ehTelefone = (s) => soDigitos(s).length >= 8 && !/[a-z]/i.test(s);
const cortado = (s) => /(\.\.\.|…)$/.test(s);

/** Nome, e-mail e telefone da célula "Cliente" do relatório (as linhas variam: só telefone, nome+e-mail+telefone...). */
/**
 * Pessoa de uma célula (nome, e-mail, telefones), reconhecendo cada linha pelo
 * conteúdo. O Hypnobox corta na tela e-mail e nome compridos ("fulano@ya..."):
 * o pedaço que sobra é guardado com a marca de cortado, para comparar pelo começo.
 */
const semCorte = (s) => R.limpa(s).replace(/\s*(\.\.\.|…)$/, "");
function pessoa(linhas) {
  const l = (linhas || []).map(R.semTraco).filter(Boolean);
  const email = l.find(ehEmail) || "";
  const nome =
    l.find(
      (x) => x !== email && !ehTelefone(x) && !/^(m[ií]dia|canal|sub ?canal|cadastro)\b/i.test(x),
    ) || "";
  return {
    email: semCorte(email).toLowerCase().replace(/\s+/g, ""),
    emailCortado: cortado(email),
    nome: chaveNome(semCorte(nome)),
    nomeCortado: cortado(nome),
    tels: l.filter(ehTelefone).map(R.normalizaTelefone).filter(Boolean),
  };
}
const chavePessoa = (p, id) => id || p.tels[0] || (p.email && !p.emailCortado ? p.email : "") || "";

/** Índice por telefone (exato) e por e-mail/nome (exato ou pelo começo, se cortado). Só devolve quando há um único candidato. */
function criarIndice() {
  const porTel = new Map();
  const emails = [];
  const nomes = [];
  const unico = (lista, q, qCortado, minimo) => {
    if (!q || q.length < minimo) return null;
    let achado = null;
    for (const [k, kCortado, v] of lista) {
      const ok = k === q || (qCortado && k.startsWith(q)) || (kCortado && q.startsWith(k));
      if (!ok) continue;
      if (achado !== null && achado !== v) return null; // mais de um candidato
      achado = v;
    }
    return achado;
  };
  return {
    add(p, valor) {
      for (const t of p.tels) if (!porTel.has(t)) porTel.set(t, valor);
      if (p.email) emails.push([p.email, p.emailCortado, valor]);
      if (p.nome) nomes.push([p.nome, p.nomeCortado, valor]);
    },
    achar(p) {
      for (const t of p.tels) if (porTel.has(t)) return porTel.get(t);
      return unico(emails, p.email, p.emailCortado, 6) || unico(nomes, p.nome, p.nomeCortado, 8);
    },
  };
}

/** Mídia na célula "Canal / Sub canal / Mídia / Grupo mídia": a que cita a LEN ou a 3ª linha. */
function midiaDaCelula(linhas) {
  const l = linhas.map(R.semTraco).filter(Boolean);
  return l.find((x) => /len/i.test(x)) || l[2] || "";
}

function indiceDeContatos(contatos) {
  const porId = new Map();
  const indice = criarIndice();
  const porPessoa = new Map(); // o mesmo cliente em vários contatos vira um só
  // o contato mais antigo de cada cliente define a origem
  const ordenados = [...contatos].sort((a, b) =>
    String(brIso(a.data[0]) || "").localeCompare(String(brIso(b.data[0]) || "")),
  );
  for (const c of ordenados) {
    const p = pessoa(c.cliente);
    const chave = chavePessoa(p, c.id_cliente);
    const info = (chave && porPessoa.get(chave)) || {
      id: c.id_cliente,
      linhas: c.canal,
      midia: midiaDaCelula(c.canal),
      canal: R.semTraco(c.canal[0]) || null,
    };
    if (chave && !porPessoa.has(chave)) porPessoa.set(chave, info);
    if (c.id_cliente && !porId.has(c.id_cliente)) porId.set(c.id_cliente, info);
    indice.add(p, info);
  }
  const achar = (id, p) => (id && porId.get(id)) || indice.achar(p) || null;

  return {
    /** contato do cliente no relatório (mídia e linhas de canal), ou null */
    origemDoCliente(c) {
      return achar(c.id, pessoa(c.c1));
    },
    midiaDoCliente(c) {
      const x = achar(c.id, pessoa(c.c1));
      return x && x.midia ? x.midia : null;
    },
    /** id do cliente de cada visita (pelo cliente da visita) e origem de quem não está na lista de clientes. */
    detalhesDasVisitas(visitas, clientes) {
      const cli = criarIndice();
      for (const c of clientes) cli.add(pessoa(c.c1), c.id);
      const idCliente = {};
      const origem = {};
      for (const v of visitas) {
        const p = pessoa(v.c2);
        let id = cli.achar(p);
        const ct = achar(null, p);
        if (!id && ct && ct.id) id = ct.id;
        if (!id) continue;
        idCliente[v.visita_id] = id;
        if (ct && !origem[id]) origem[id] = { midia: ct.midia, canal: ct.canal };
      }
      return { idCliente, origem };
    },
  };
}

/** Mídia completa das mensagens recebidas ("Mídia: ..."), achada pelo cliente da mensagem. */
function indiceDeMensagens(mensagens) {
  const indice = criarIndice();
  const porPessoa = new Map();
  const nomes = new Set();
  for (const m of mensagens) {
    const x = (m.c6 || []).find((t) => /^m[ií]dia:/i.test(t));
    const midia = x ? R.limpa(x.replace(/^m[ií]dia:\s*/i, "")) : "";
    if (!midia || cortado(midia)) continue;
    nomes.add(midia);
    const p = pessoa(m.c4);
    const chave = chavePessoa(p);
    const valor = (chave && porPessoa.get(chave)) || midia;
    if (chave && !porPessoa.has(chave)) porPessoa.set(chave, valor);
    indice.add(p, valor);
  }
  const doCliente = (c) => indice.achar(pessoa(c.c1));
  /** Mídia cortada na tela ("google-ad...") completada pelo nome inteiro, se só um nome combina. */
  doCliente.completar = (texto) => {
    if (!texto || !cortado(texto)) return texto;
    const base = semCorte(texto).toLowerCase();
    if (base.length < 4) return texto;
    const cands = [...nomes].filter((n) => n.toLowerCase().startsWith(base));
    return cands.length === 1 ? cands[0] : texto;
  };
  return doCliente;
}

/** Canal e campanha de quem não veio da LEN (carteira do corretor ou orgânico). */
function campDoGrupo(c) {
  return c._grupo === "carteira"
    ? { canal: "Carteira do corretor", campanha: "Carteira do corretor", palavra_chave: null }
    : {
        canal: "Orgânico",
        campanha: c.midia ? `Orgânico · ${R.limpa(c.midia)}` : "Orgânico",
        palavra_chave: null,
      };
}

/** Mídia do cliente: filtro de uma mídia só > relatório de contatos (se não veio cortada) > mensagens. */
function midiaDoCliente(c, o, daMensagem) {
  if (c.midia) return c.midia;
  const doRelatorio = o && o.midia ? daMensagem.completar(o.midia) : null;
  if (doRelatorio && /len/i.test(doRelatorio)) return doRelatorio;
  const msg = daMensagem(c);
  if (msg && (/len/i.test(msg) || !doRelatorio || cortado(doRelatorio))) return msg;
  return doRelatorio;
}

export function montarCargaGuiada(
  dados,
  prontos,
  periodo,
  len,
  existentes: Set<string> | null = null,
) {
  const contatos = Object.values(dados.contatos);
  const origem = indiceDeContatos(contatos);
  const daMensagem = indiceDeMensagens(Object.values(dados.mensagens));
  const todos = prontos.clientes
    ? Object.values(dados.clientes).map((c) => {
        const o = origem.origemDoCliente(c);
        const midia = midiaDoCliente(c, o, daMensagem);
        // a ficha do cliente também traz o canal de contato (c4[1]) e o subcanal (c4[2])
        return {
          ...c,
          midia,
          _grupo: grupoDoCliente(midia, [...((o && o.linhas) || []), ...c.c4.slice(1)]),
        };
      })
    : null;
  const noPeriodo = (c) => {
    const cad = R.dataBR(c.c2[1]);
    return cad && cad >= periodo.de && cad <= periodo.ate;
  };
  const doLen = todos ? todos.filter((c) => c._grupo === "len") : [];
  const leadsLen = doLen.filter(noPeriodo);
  // orgânicos e carteira entram só para os corretores que têm leads LEN nesta coleta
  const corretores = new Set(leadsLen.map((c) => R.semTraco(c.c3[0])).filter(Boolean));
  const extras = (todos || [])
    .filter(
      (c) =>
        (c._grupo === "organico" || c._grupo === "carteira") &&
        noPeriodo(c) &&
        corretores.has(R.semTraco(c.c3[0])),
    )
    .map((c) => ({ ...c, _camp: campDoGrupo(c) }));
  // quem já está no banco e reapareceu na tela de Clientes é atualizado (momento,
  // corretor, status...), mesmo com cadastro fora do período desta coleta
  const incluidos = new Set([...leadsLen, ...extras].map((c) => String(c.id)));
  const atualizados = existentes
    ? (todos || [])
        .filter((c) => existentes.has(String(c.id)) && !incluidos.has(String(c.id)))
        .map((c) =>
          c._grupo === "len"
            ? { ...c, _fora: true }
            : c._grupo === "organico" || c._grupo === "carteira"
              ? { ...c, _fora: true, _camp: campDoGrupo(c) }
              : { ...c, _fora: true, _semMidia: true },
        )
    : [];
  const clientes = todos
    ? { clientes: [...leadsLen, ...extras, ...atualizados], todos: [...doLen, ...extras] }
    : null;
  let visitas = null;
  let detalhes = null;
  if (prontos.visitas) {
    visitas = Object.values(dados.visitas);
    detalhes = origem.detalhesDasVisitas(visitas, todos || []);
  }
  const msgs = prontos.mensagens ? Object.values(dados.mensagens) : null;
  const midiaMsg = (m) => {
    const x = m.c6.find((t) => /^m[ií]dia:/i.test(t));
    return x ? R.limpa(x.replace(/^m[ií]dia:\s*/i, "")) : "";
  };
  const mensagens = msgs
    ? {
        mensagens: msgs
          .filter((m) => /len/i.test(midiaMsg(m)))
          .map((m) => ({ ...m, midia: midiaMsg(m) })),
        total: msgs.length,
      }
    : null;
  if (!clientes && !len)
    throw new Error(
      "Nada pronto para gravar: conclua o passo Clientes ou sincronize o dash da LEN.",
    );
  const carga = montarCarga(
    { clientes, visitas: visitas && detalhes ? visitas : null, detalhes, mensagens, len },
    { dataColeta: R.hojeISO(), periodo },
  );
  // "Leads LEN" conta só os do período; os já existentes atualizados vêm numa linha à parte
  const linhaLen = carga.checagens.find((c) => c.nome === "Leads LEN");
  if (linhaLen) {
    linhaLen.valor = leadsLen.length;
    linhaLen.texto = leadsLen.length.toLocaleString("pt-BR");
    linhaLen.alerta = linhaLen.referencia
      ? Math.abs(leadsLen.length - linhaLen.referencia) / linhaLen.referencia > 0.25
      : false;
  }
  if (atualizados.length)
    carga.checagens.push({
      nome: "Leads que já estavam no banco, atualizados",
      valor: atualizados.length,
      referencia: 0,
      texto: atualizados.length.toLocaleString("pt-BR"),
      referenciaTexto: "—",
      alerta: false,
    });
  if (todos) {
    const semMidia = todos.filter((c) => !c.midia).length;
    carga.checagens.push({
      nome: "Clientes lidos sem mídia identificada",
      valor: semMidia,
      referencia: 0,
      texto: semMidia.toLocaleString("pt-BR"),
      referenciaTexto: "—",
      alerta: todos.length > 0 && semMidia / todos.length > 0.25,
    });
  }
  if (detalhes) {
    const sem = visitas.length - Object.keys(detalhes.idCliente).length;
    carga.checagens.push({
      nome: "Visitas sem cliente identificado",
      valor: sem,
      referencia: 0,
      texto: sem.toLocaleString("pt-BR"),
      referenciaTexto: "—",
      alerta: visitas.length > 0 && sem / visitas.length > 0.25,
    });
  }
  return carga;
}

/**
 * Resumo do que foi lido, sem dado pessoal (nada de nome, e-mail ou telefone),
 * para entender por que um cliente entrou ou não como lead LEN.
 */
export function diagnosticoGuiado(dados, periodo) {
  const contatos = Object.values(dados.contatos);
  const clientes = Object.values(dados.clientes);
  const origem = indiceDeContatos(contatos);
  const daMensagem = indiceDeMensagens(Object.values(dados.mensagens));
  const conta = (xs) =>
    Object.entries(xs.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {}))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);
  const cad = clientes
    .map((c) => R.dataBR(c.c2[1]))
    .filter(Boolean)
    .sort();
  const grupos = clientes.map((c) => {
    const o = origem.origemDoCliente(c);
    const midia = midiaDoCliente(c, o, daMensagem);
    return {
      grupo: grupoDoCliente(midia, [...((o && o.linhas) || []), ...c.c4.slice(1)]) || "sem grupo",
      achouContato: Boolean(o),
      achouMensagem: Boolean(daMensagem(c)),
      midia: midia || "(sem mídia)",
      noPeriodo: Boolean(
        R.dataBR(c.c2[1]) && R.dataBR(c.c2[1]) >= periodo.de && R.dataBR(c.c2[1]) <= periodo.ate,
      ),
    };
  });
  // formato das células sem o conteúdo: letras viram "a", dígitos "0" (e-mail vira a@a)
  const forma = (v) =>
    String(v ?? "")
      .replace(/[^\s@]+@[^\s@]+/g, "a@a")
      .replace(/[A-Za-zÀ-ÿ]+/g, "a")
      .replace(/\d/g, "0")
      .slice(0, 40);
  const formas = (linhas) => (linhas || []).map(forma);
  const amostra = (xs, f) => xs.slice(0, 6).map(f);
  return {
    periodo,
    formato: {
      cliente: amostra(clientes, (c) => ({
        c1: formas(c.c1),
        coluna: forma(c.coluna),
        c2: formas(c.c2),
        c3: (c.c3 || []).length,
        c4: (c.c4 || []).length,
        c5: (c.c5 || []).length,
      })),
      contato_cliente: amostra(contatos, (c) => formas(c.cliente)),
      visita_cliente: amostra(Object.values(dados.visitas), (v) => formas(v.c2)),
      mensagem_cliente: amostra(Object.values(dados.mensagens), (m) => formas(m.c4)),
      clientes_com_email: clientes.filter((c) => (c.c1 || []).some((x) => /@/.test(x))).length,
      clientes_com_telefone: clientes.filter((c) =>
        (c.c1 || []).some((x) => String(x).replace(/\D/g, "").length >= 8),
      ).length,
    },
    contatos: {
      linhas: contatos.length,
      com_id_cliente: contatos.filter((c) => c.id_cliente).length,
      com_texto_cortado: contatos.filter((c) => c.cortados).length,
      celulas_canal_midia: conta(contatos.map((c) => (c.canal || []).join(" | "))),
    },
    clientes: {
      linhas: clientes.length,
      cadastro_de: cad[0] || null,
      cadastro_ate: cad[cad.length - 1] || null,
      no_periodo: grupos.filter((g) => g.noPeriodo).length,
      achou_no_relatorio: grupos.filter((g) => g.achouContato).length,
      achou_nas_mensagens: grupos.filter((g) => g.achouMensagem).length,
      por_grupo: conta(grupos.map((g) => g.grupo)),
      midias: conta(grupos.map((g) => g.midia)),
      canal_da_ficha: conta(clientes.map((c) => (c.c4 || []).slice(1).join(" | "))),
    },
    visitas: Object.keys(dados.visitas).length,
    mensagens: {
      linhas: Object.keys(dados.mensagens).length,
      midias: conta(
        Object.values(dados.mensagens).map(
          (m) => (m.c6 || []).find((t) => /^m[ií]dia:/i.test(t)) || "(sem mídia)",
        ),
      ),
    },
  };
}
