// Expediente individual por profissional e folgas recorrentes (migration 7).
// Cobre: leitura/gravação dos helpers de db, o cálculo de disponibilidade
// por profissional (horariosLivres, diasDisponiveis com e sem barbeiro), e
// as rotas GET/PUT /api/admin/barbeiros/[id]/expediente e
// GET /api/public?barbeiro=<id>.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  horariosLivres,
  diasDisponiveis,
  diaDaSemana,
  somarDias,
  agora,
} from "../src/lib/slots.js";
import {
  salvarConfig,
  lerExpedienteBarbeiro,
  salvarExpedienteBarbeiro,
  listarFolgasRecorrentes,
  definirFolgasRecorrentes,
  expedienteResumoPublico,
} from "../src/lib/db.js";
import { construirTokenBarbeiro, NOME_COOKIE } from "../src/lib/auth.js";
import { __resetCookies, __setCookie } from "./fake-next-headers.mjs";
import {
  bancoDeTeste,
  limparMovimentacao,
  criarBarbeiro,
  criarBarbeiroComLogin,
} from "./ajuda.js";

const SEGUNDA = "2024-01-08"; // segunda-feira (diaDaSemana === 1)
const TERCA = "2024-01-09"; // terça-feira (diaDaSemana === 2)

let conn;
let barbeiroA;
let barbeiroB;

beforeEach(() => {
  conn = bancoDeTeste();
  limparMovimentacao(conn);
  conn.exec("DELETE FROM folgas_recorrentes; DELETE FROM barbeiros;");
  __resetCookies();
  salvarConfig({
    intervalo_min: "30",
    antecedencia_min: "0",
    dias_futuros: "30",
  });
  barbeiroA = criarBarbeiro("Barbeiro A", conn);
  barbeiroB = criarBarbeiro("Barbeiro B", conn);
});

/** Fecha todos os dias do profissional e abre só os informados, das 09:00 às 12:00. */
function abrirApenas(barbeiroId, ...diasAbertos) {
  const dias = Array.from({ length: 7 }, (_, dia) => ({
    dia,
    aberto: diasAbertos.includes(dia) ? 1 : 0,
    abre: "09:00",
    fecha: "12:00",
  }));
  salvarExpedienteBarbeiro(barbeiroId, dias);
}

test("criar profissional já semeia os 7 dias do expediente (padrão)", () => {
  const linhas = lerExpedienteBarbeiro(barbeiroA);
  assert.equal(linhas.length, 7);
  assert.equal(linhas[0].aberto, 0); // domingo fechado
  assert.equal(linhas[1].aberto, 1); // segunda aberta
  assert.equal(linhas[1].abre, "09:00");
  assert.equal(linhas[1].fecha, "20:00");
});

test("dois profissionais com expedientes diferentes no mesmo dia oferecem horários diferentes", () => {
  salvarExpedienteBarbeiro(barbeiroA, [
    { dia: 1, aberto: 1, abre: "09:00", fecha: "11:00" },
  ]);
  salvarExpedienteBarbeiro(barbeiroB, [
    { dia: 1, aberto: 1, abre: "14:00", fecha: "16:00" },
  ]);

  assert.deepEqual(
    horariosLivres({ barbeiroId: barbeiroA, duracaoMin: 30, data: SEGUNDA }),
    ["09:00", "09:30", "10:00", "10:30"],
  );
  assert.deepEqual(
    horariosLivres({ barbeiroId: barbeiroB, duracaoMin: 30, data: SEGUNDA }),
    ["14:00", "14:30", "15:00", "15:30"],
  );
});

test("dia fechado no expediente do profissional devolve lista vazia", () => {
  salvarExpedienteBarbeiro(barbeiroA, [
    { dia: 1, aberto: 0, abre: "09:00", fecha: "20:00" },
  ]);
  assert.deepEqual(
    horariosLivres({ barbeiroId: barbeiroA, duracaoMin: 30, data: SEGUNDA }),
    [],
  );
});

test("folga recorrente naquele dia da semana zera os horários, mesmo com expediente aberto", () => {
  salvarExpedienteBarbeiro(barbeiroA, [
    { dia: 1, aberto: 1, abre: "09:00", fecha: "20:00" },
  ]);
  definirFolgasRecorrentes(barbeiroA, [1]); // não trabalha às segundas

  assert.deepEqual(
    horariosLivres({ barbeiroId: barbeiroA, duracaoMin: 30, data: SEGUNDA }),
    [],
  );
  // terça continua normal
  assert.ok(
    horariosLivres({ barbeiroId: barbeiroA, duracaoMin: 30, data: TERCA })
      .length > 0,
  );
});

test("definirFolgasRecorrentes deduplica e ignora valores fora de 0..6", () => {
  definirFolgasRecorrentes(barbeiroA, [1, 1, 2, 9, -3, "4"]);
  assert.deepEqual(listarFolgasRecorrentes(barbeiroA), [1, 2, 4]);

  definirFolgasRecorrentes(barbeiroA, []); // substitui tudo
  assert.deepEqual(listarFolgasRecorrentes(barbeiroA), []);
});

test("diasDisponiveis(qtd, barbeiroId) só devolve os dias da semana que o profissional atende", () => {
  const hojeSemana = agora().diaSemana;
  const outroDia = (hojeSemana + 2) % 7;
  abrirApenas(barbeiroA, outroDia); // só um dia da semana aberto

  const dias = diasDisponiveis(5, barbeiroA);
  assert.ok(dias.length > 0);
  for (const d of dias) assert.equal(diaDaSemana(d), outroDia);
});

test("diasDisponiveis(qtd, barbeiroId) exclui os dias de folga recorrente", () => {
  const hojeSemana = agora().diaSemana;
  const diaAberto = (hojeSemana + 1) % 7;
  abrirApenas(barbeiroA, diaAberto);
  definirFolgasRecorrentes(barbeiroA, [diaAberto]);

  assert.deepEqual(diasDisponiveis(5, barbeiroA), []);
});

test("diasDisponiveis() sem barbeiro é a união: um dia entra se ao menos um profissional ativo atende", () => {
  const hojeSemana = agora().diaSemana;
  const soA = (hojeSemana + 1) % 7;
  const soB = (hojeSemana + 3) % 7;
  abrirApenas(barbeiroA, soA);
  abrirApenas(barbeiroB, soB);

  const semana = new Set(diasDisponiveis(60).map((d) => diaDaSemana(d)));
  assert.ok(semana.has(soA), "dia coberto só pelo A deveria aparecer");
  assert.ok(semana.has(soB), "dia coberto só pelo B deveria aparecer");
  // um dia que nenhum dos dois abre não entra
  const nenhum = (hojeSemana + 5) % 7;
  if (nenhum !== soA && nenhum !== soB) {
    assert.ok(!semana.has(nenhum));
  }
});

test("expedienteResumoPublico agrega a faixa: menor abre, maior fecha entre os ativos", () => {
  salvarExpedienteBarbeiro(barbeiroA, [
    { dia: 1, aberto: 1, abre: "10:00", fecha: "18:00" },
  ]);
  salvarExpedienteBarbeiro(barbeiroB, [
    { dia: 1, aberto: 1, abre: "08:00", fecha: "16:00" },
  ]);
  const segunda = expedienteResumoPublico().find((r) => r.dia === 1);
  assert.equal(segunda.aberto, 1);
  assert.equal(segunda.abre, "08:00");
  assert.equal(segunda.fecha, "18:00");
});

test("GET/PUT /api/admin/barbeiros/[id]/expediente faz o round-trip", async () => {
  const adminId = await criarBarbeiroComLogin({ papel: "admin" }, conn);
  __setCookie(
    NOME_COOKIE,
    construirTokenBarbeiro(adminId, "1", Date.now() + 60_000),
  );
  const { GET, PUT } =
    await import("../src/app/api/admin/barbeiros/[id]/expediente/route.js");

  const antes = await GET(
    new Request("http://localhost/api/admin/barbeiros/x/expediente"),
    { params: { id: String(barbeiroA) } },
  );
  assert.equal(antes.status, 200);
  const corpoAntes = await antes.json();
  assert.equal(corpoAntes.expediente.length, 7);
  assert.deepEqual(corpoAntes.folgas, []);

  const resp = await PUT(
    new Request("http://localhost/api/admin/barbeiros/x/expediente", {
      method: "PUT",
      body: JSON.stringify({
        expediente: [{ dia: 1, aberto: 1, abre: "10:00", fecha: "13:00" }],
        folgas: [0, 6, 6, 9],
      }),
    }),
    { params: { id: String(barbeiroA) } },
  );
  assert.equal(resp.status, 200);
  const corpo = await resp.json();
  assert.equal(corpo.folgas.length, 2); // 6 deduplicado, 9 descartado
  assert.deepEqual(
    corpo.expediente.find((d) => d.dia === 1),
    { dia: 1, aberto: 1, abre: "10:00", fecha: "13:00" },
  );

  assert.deepEqual(
    horariosLivres({ barbeiroId: barbeiroA, duracaoMin: 30, data: SEGUNDA }),
    ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30"],
  );
});

test("PUT do expediente recusa fecha <= abre com 400", async () => {
  const adminId = await criarBarbeiroComLogin({ papel: "admin" }, conn);
  __setCookie(
    NOME_COOKIE,
    construirTokenBarbeiro(adminId, "1", Date.now() + 60_000),
  );
  const { PUT } =
    await import("../src/app/api/admin/barbeiros/[id]/expediente/route.js");
  const resp = await PUT(
    new Request("http://localhost/api/admin/barbeiros/x/expediente", {
      method: "PUT",
      body: JSON.stringify({
        expediente: [{ dia: 1, aberto: 1, abre: "12:00", fecha: "12:00" }],
      }),
    }),
    { params: { id: String(barbeiroA) } },
  );
  assert.equal(resp.status, 400);
});

test("PUT do expediente num profissional inexistente responde 404", async () => {
  const adminId = await criarBarbeiroComLogin({ papel: "admin" }, conn);
  __setCookie(
    NOME_COOKIE,
    construirTokenBarbeiro(adminId, "1", Date.now() + 60_000),
  );
  const { PUT } =
    await import("../src/app/api/admin/barbeiros/[id]/expediente/route.js");
  const resp = await PUT(
    new Request("http://localhost/api/admin/barbeiros/x/expediente", {
      method: "PUT",
      body: JSON.stringify({ folgas: [1] }),
    }),
    { params: { id: "999999" } },
  );
  assert.equal(resp.status, 404);
});

test("GET /api/public?barbeiro=<id> devolve os dias daquele profissional", async () => {
  const hojeSemana = agora().diaSemana;
  const diaAberto = (hojeSemana + 1) % 7;
  abrirApenas(barbeiroA, diaAberto);
  // B abre outro dia — não pode vazar para a resposta filtrada por A.
  abrirApenas(barbeiroB, (hojeSemana + 4) % 7);

  const { GET } = await import("../src/app/api/public/route.js");
  const resp = await GET(
    new Request(`http://localhost/api/public?barbeiro=${barbeiroA}`),
  );
  assert.equal(resp.status, 200);
  const corpo = await resp.json();
  assert.ok(corpo.dias.length > 0);
  for (const d of corpo.dias) assert.equal(diaDaSemana(d), diaAberto);
});

test("GET /api/public sem barbeiro devolve a união dos dias", async () => {
  const hojeSemana = agora().diaSemana;
  const soA = (hojeSemana + 1) % 7;
  const soB = (hojeSemana + 3) % 7;
  abrirApenas(barbeiroA, soA);
  abrirApenas(barbeiroB, soB);

  const { GET } = await import("../src/app/api/public/route.js");
  const resp = await GET(new Request("http://localhost/api/public"));
  const { dias } = await resp.json();
  const semanas = new Set(dias.map((d) => diaDaSemana(d)));
  assert.ok(semanas.has(soA) && semanas.has(soB));
});

// Guard extra: uma segunda futura fora da janela nunca aparece com dias_futuros baixo.
test("diasDisponiveis respeita dias_futuros", () => {
  salvarConfig({ dias_futuros: "3" });
  abrirApenas(barbeiroA, 0, 1, 2, 3, 4, 5, 6); // todo dia aberto
  const dias = diasDisponiveis(3, barbeiroA);
  assert.equal(dias.length, 3);
  const limite = somarDias(agora().data, 3);
  for (const d of dias) assert.ok(d < limite);
});
