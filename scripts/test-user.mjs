// Conta de teste invisível (profiles.is_test) — criar e trocar de perfil.
//
//   node scripts/test-user.mjs status
//   node scripts/test-user.mjs create            cria a conta e mostra a senha
//   node scripts/test-user.mjs senha             gera uma senha nova
//   node scripts/test-user.mjs cliente          cria o cliente (lead) de teste TESTE-001
//   node scripts/test-user.mjs admin
//   node scripts/test-user.mjs rh
//   node scripts/test-user.mjs gerente
//   node scripts/test-user.mjs corretor [nome ou e-mail do gerente]
//
// Usa SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do .env (nunca vai para o site).
// Requer a migration 20261007000001_test_user.sql aplicada.
import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const URL_ = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env");

const EMAIL = "teste.sistema@pgvendas.com.br";
const NAME = "Conta de Teste";
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function api(path, init = {}) {
  const res = await fetch(URL_ + path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body?.message ?? body?.msg ?? text}`);
  return body;
}
const rest = (path, init) => api("/rest/v1/" + path, init);
const newPassword = () => "Teste@" + randomInt(100000, 999999);

async function getTest() {
  const rows = await rest(
    `profiles?select=id,full_name,email,role,manager_id,is_test,is_active,cargo:cargos(name)&is_test=eq.true`,
  );
  return rows[0] ?? null;
}

async function setRole(role, managerId) {
  const t = await getTest();
  if (!t) throw new Error("Conta de teste não existe. Rode: node scripts/test-user.mjs create");
  const [updated] = await rest(`profiles?id=eq.${t.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    // trocar o papel aplica o cargo padrão daquele tipo (ADM, Gestor, Corretor, RH)
    body: JSON.stringify({ role, manager_id: managerId ?? null, is_active: true }),
  });
  return updated;
}

const [cmd = "status", arg] = process.argv.slice(2);

if (cmd === "status") {
  const t = await getTest();
  if (!t) console.log("Conta de teste ainda não criada.");
  else {
    let team = "—";
    if (t.manager_id) {
      const [m] = await rest(`profiles?select=full_name,team_name&id=eq.${t.manager_id}`);
      team = m ? (m.team_name ?? m.full_name) : "—";
    }
    console.log(`${t.email} | perfil: ${t.cargo?.name ?? t.role} (${t.role}) | equipe: ${team}`);
  }
} else if (cmd === "create") {
  if (await getTest()) throw new Error("A conta de teste já existe (use status).");
  const password = newPassword();
  const user = await api("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password, email_confirm: true, user_metadata: { full_name: NAME } }),
  });
  // marca como teste antes de qualquer outra coisa: a conta nunca fica visível
  await rest(`profiles?id=eq.${user.id}`, {
    method: "PATCH",
    body: JSON.stringify({ is_test: true, full_name: NAME, role: "broker", manager_id: null }),
  });
  console.log(`Conta criada.\n  e-mail: ${EMAIL}\n  senha:  ${password}\n  perfil: Corretor (sem equipe)`);
} else if (cmd === "senha") {
  const t = await getTest();
  if (!t) throw new Error("Conta de teste não existe.");
  const password = newPassword();
  await api(`/auth/v1/admin/users/${t.id}`, { method: "PUT", body: JSON.stringify({ password }) });
  console.log(`Nova senha de ${EMAIL}: ${password}`);
} else if (cmd === "admin" || cmd === "rh") {
  await setRole(cmd === "admin" ? "admin" : "hr", null);
  console.log(`Conta de teste agora é ${cmd === "admin" ? "ADM" : "RH"}.`);
} else if (cmd === "gerente") {
  // gerente fica abaixo do admin real, como os demais
  const [adm] = await rest(`profiles?select=id&role=eq.admin&is_test=eq.false&order=created_at&limit=1`);
  await setRole("master", adm?.id ?? null);
  console.log("Conta de teste agora é Gerente (equipe própria, vazia).");
} else if (cmd === "corretor") {
  const managers = await rest(`profiles?select=id,full_name,email,team_name&role=eq.master&is_test=eq.false&is_active=eq.true&order=full_name`);
  const q = (arg ?? "").toLowerCase();
  const m = q
    ? managers.find((x) => [x.full_name, x.email, x.team_name].some((v) => (v ?? "").toLowerCase().includes(q)))
    : managers[0];
  if (!m) throw new Error(`Gerente não encontrado. Opções: ${managers.map((x) => x.full_name).join(", ")}`);
  await setRole("broker", m.id);
  console.log(`Conta de teste agora é Corretor na equipe de ${m.full_name}.`);
} else if (cmd === "cliente") {
  // cliente (lead) de teste, dono = conta de teste. Gerente não recebe lead:
  // se a conta estiver como gerente, vira corretor só durante a criação.
  const t = await getTest();
  if (!t) throw new Error("Conta de teste não existe.");
  const CODE = "TESTE-001";
  const existing = await rest(`leads?select=id,full_name,client_code&broker_id=eq.${t.id}&client_code=eq.${CODE}`);
  if (existing.length) {
    console.log(`Cliente de teste já existe: ${existing[0].full_name} (ID ${CODE}).`);
  } else {
    const [stage] = await rest("funnel_stages?select=id,funnel_id&kind=eq.new&order=sort_order&limit=1");
    if (!stage) throw new Error("Funil padrão não encontrado.");
    const wasManager = t.role === "master";
    if (wasManager) await rest(`profiles?id=eq.${t.id}`, { method: "PATCH", body: JSON.stringify({ role: "broker" }) });
    try {
      await rest("leads", {
        method: "POST",
        body: JSON.stringify({
          full_name: "Cliente Teste",
          client_code: CODE,
          phone: "11999990000",
          email: "cliente.teste@exemplo.com",
          broker_id: t.id,
          created_by: t.id,
          funnel_id: stage.funnel_id,
          stage_id: stage.id,
          source: "manual",
        }),
      });
    } finally {
      if (wasManager)
        await rest(`profiles?id=eq.${t.id}`, {
          method: "PATCH",
          body: JSON.stringify({ role: "master", manager_id: t.manager_id }),
        });
    }
    console.log(`Cliente de teste criado: Cliente Teste (ID ${CODE}), na etapa "Cliente novo".`);
  }
} else {
  console.log("Comandos: status | create | senha | cliente | admin | rh | gerente | corretor [gerente]");
}
