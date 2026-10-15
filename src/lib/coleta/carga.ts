/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck -- regras portadas do extrator (testadas com o Hypnobox falso); os tipos ficam em montarCargaGuiada
/**
 * Monta as tabelas al_* a partir do que foi lido nas telas do Hypnobox e do dash
 * da LEN. A gravação é do servidor (al_sincronizar): leads e visitas são
 * sincronizados (atualiza os que existem, insere os novos); os resumos são trocados.
 */
import * as R from "./regras";

const brIso = (s) => R.dataBR(s);

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
    const camp = c._camp || R.campanhaDaMidia(c.midia);
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
      nome: nome || null,
      email: R.normalizaEmail(email) || null,
      telefone: R.normalizaTelefone(tel) || null,
      telefone_original: tel || null,
      // auxiliares (não vão para o banco)
      _midia: c.midia,
      _extra: Boolean(c._camp),
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
      nome_cliente: R.semTraco(v.c2[0]) || null,
      email_cliente: R.normalizaEmail(R.semTraco(v.c2[1])) || null,
    };
  });
}

function montarMensagens(mensagens) {
  const porCorretor = new Map();
  const porFaixa = FAIXAS.map(([faixa, ordem]) => ({
    faixa,
    ordem: FAIXAS.findIndex((f) => f[0] === faixa),
    mensagens: 0,
  }));
  for (const m of mensagens) {
    const corretor = R.semTraco(m.c2[0]) || "(sem corretor)";
    const c = porCorretor.get(corretor) || {
      corretor,
      mensagens: 0,
      respondidas: 0,
      lidas_sem_resposta: 0,
      direcionadas: 0,
      nao_lidas: 0,
    };
    c.mensagens++;
    if (m.status === "respondida") c.respondidas++;
    else if (m.status === "lida") c.lidas_sem_resposta++;
    else if (m.status === "direcionada") c.direcionadas++;
    else if (m.status === "nao_lida") c.nao_lidas++;
    porCorretor.set(corretor, c);
    const h = /(\d{1,2}):\d{2}/.exec(m.c1.join(" "));
    if (h) {
      const hh = Number(h[1]);
      const i = FAIXAS.findIndex(([, a, b]) => hh >= a && hh < b);
      if (i >= 0) porFaixa[i].mensagens++;
    }
  }
  return {
    al_mensagens_corretor: [...porCorretor.values()].sort((a, b) => b.mensagens - a.mensagens),
    al_mensagens_horario: porFaixa,
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
        leads.filter((l) => !l._extra),
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
function contatoDoCliente(linhas) {
  const l = linhas.map(R.semTraco).filter(Boolean);
  const email = l.find(ehEmail) || "";
  const tel = l.find(ehTelefone) || "";
  const nome = l.find((x) => x !== email && x !== tel && !ehTelefone(x)) || "";
  return {
    nome: cortado(nome) ? "" : nome,
    email: cortado(email) ? "" : R.normalizaEmail(email),
    telefone: R.normalizaTelefone(tel),
  };
}

/** Mídia na célula "Canal / Sub canal / Mídia / Grupo mídia": a que cita a LEN ou a 3ª linha. */
function midiaDaCelula(linhas) {
  const l = linhas.map(R.semTraco).filter(Boolean);
  return l.find((x) => /len/i.test(x)) || l[2] || "";
}

function indiceDeContatos(contatos) {
  const porId = new Map();
  const porTel = new Map();
  const porEmail = new Map();
  const porNome = new Map();
  // o contato mais antigo de cada cliente define a origem
  const ordenados = [...contatos].sort((a, b) =>
    String(brIso(a.data[0]) || "").localeCompare(String(brIso(b.data[0]) || "")),
  );
  for (const c of ordenados) {
    const k = contatoDoCliente(c.cliente);
    const info = {
      id: c.id_cliente,
      linhas: c.canal,
      midia: midiaDaCelula(c.canal),
      canal: R.semTraco(c.canal[0]) || null,
      ...k,
    };
    const pos = (m, chave) => {
      if (chave && !m.has(chave)) m.set(chave, info);
    };
    pos(porId, c.id_cliente);
    pos(porTel, k.telefone);
    pos(porEmail, k.email);
    if (k.nome) {
      const n = chaveNome(k.nome);
      porNome.set(n, porNome.has(n) && porNome.get(n) !== info ? null : info); // nome repetido não serve
    }
  }
  const achar = ({ id, telefone, email, nome }) =>
    (id && porId.get(id)) ||
    (telefone && porTel.get(telefone)) ||
    (email && porEmail.get(email)) ||
    (nome && porNome.get(chaveNome(nome))) ||
    null;

  return {
    /** contato do cliente no relatório (mídia e linhas de canal), ou null */
    origemDoCliente(c) {
      const [nome = "", email = "", tel = ""] = c.c1.map(R.semTraco);
      return achar({
        id: c.id,
        telefone: R.normalizaTelefone(tel),
        email: R.normalizaEmail(email),
        nome,
      });
    },
    midiaDoCliente(c) {
      const [nome = "", email = "", tel = ""] = c.c1.map(R.semTraco);
      const x = achar({
        id: c.id,
        telefone: R.normalizaTelefone(tel),
        email: R.normalizaEmail(email),
        nome,
      });
      return x && x.midia ? x.midia : null;
    },
    /** id do cliente de cada visita (pelo e-mail ou nome do cliente da visita) e origem de quem não está na lista de clientes. */
    detalhesDasVisitas(visitas, clientes) {
      const cliEmail = new Map();
      const cliNome = new Map();
      for (const c of clientes) {
        const [nome = "", email = ""] = c.c1.map(R.semTraco);
        if (email) cliEmail.set(R.normalizaEmail(email), c.id);
        if (nome) {
          const n = chaveNome(nome);
          cliNome.set(n, cliNome.has(n) ? null : c.id);
        }
      }
      const idCliente = {};
      const origem = {};
      for (const v of visitas) {
        const nome = R.semTraco(v.c2[0]);
        const email = R.normalizaEmail(R.semTraco(v.c2[1]));
        let id = (email && cliEmail.get(email)) || (nome && cliNome.get(chaveNome(nome))) || null;
        const ct = achar({ email, nome });
        if (!id && ct && ct.id) id = ct.id;
        if (!id) continue;
        idCliente[v.visita_id] = id;
        if (ct && !origem[id]) origem[id] = { midia: ct.midia, canal: ct.canal };
      }
      return { idCliente, origem };
    },
  };
}

/**
 * Carga a partir do roteiro guiado. `prontos` diz quais passos foram concluídos;
 * os contatos entram mesmo incompletos (só ajudam a achar a mídia).
 */
export function montarCargaGuiada(dados, prontos, periodo, len) {
  const contatos = Object.values(dados.contatos);
  const origem = indiceDeContatos(contatos);
  const todos = prontos.clientes
    ? Object.values(dados.clientes).map((c) => {
        const o = origem.origemDoCliente(c);
        const midia = c.midia || (o && o.midia) || null;
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
    .map((c) => ({
      ...c,
      _camp:
        c._grupo === "carteira"
          ? { canal: "Carteira do corretor", campanha: "Carteira do corretor", palavra_chave: null }
          : {
              canal: "Orgânico",
              campanha: c.midia ? `Orgânico · ${R.limpa(c.midia)}` : "Orgânico",
              palavra_chave: null,
            },
    }));
  const clientes = todos
    ? { clientes: [...leadsLen, ...extras], todos: [...doLen, ...extras] }
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
