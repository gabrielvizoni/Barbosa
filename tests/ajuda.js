// Helpers compartilhados pela bateria de testes.
//
// Cada arquivo de teste roda em um processo próprio (comportamento padrão do
// `node --test`), com seu próprio arquivo de banco temporário (ver
// tests/register-hooks.mjs). getDb() não aplica mais migrations sozinho —
// só verifica a versão e recusa subir se não bater — então bancoDeTeste()
// aplica as migrations numa conexão própria antes da primeira chamada a
// getDb() do processo, exatamente como `npm run migrate` faria antes de
// subir o servidor de verdade.
import { getDb, abrirConexao } from "../src/lib/db.js";
import { aplicarMigrations } from "../src/lib/migrations.js";
import { gerarHash } from "../src/lib/auth.js";

let migrado = false;

/** Garante as migrations aplicadas e devolve o banco de teste do processo atual. */
export function bancoDeTeste() {
  if (!migrado) {
    const conexaoDeMigracao = abrirConexao();
    aplicarMigrations(conexaoDeMigracao);
    conexaoDeMigracao.close();
    migrado = true;
  }
  return getDb();
}

/** Remove agendamentos, bloqueios e tentativas de rate limit entre testes. */
export function limparMovimentacao(conn = getDb()) {
  conn.exec(
    "DELETE FROM agendamentos; DELETE FROM bloqueios; DELETE FROM limitador;",
  );
}

/**
 * Sobrescreve o expediente de um dia (0=domingo..6=sábado) para TODOS os
 * profissionais já criados no teste. O expediente virou individual por
 * profissional (migration 7), mas a maioria dos testes só quer "esse dia
 * está aberto das X às Y para quem eu criei aqui" — por isso o helper
 * mantém a assinatura antiga e aplica a todos. Chame `criarBarbeiro` antes.
 */
export function definirExpediente(
  dia,
  { aberto = 1, abre = "09:00", fecha = "20:00" } = {},
  conn = getDb(),
) {
  conn
    .prepare(
      "UPDATE expediente_barbeiro SET aberto = ?, abre = ?, fecha = ? WHERE dia = ?",
    )
    .run(aberto ? 1 : 0, abre, fecha, dia);
}

/** Cria um barbeiro dedicado ao teste, sem depender do seed padrão. */
export function criarBarbeiro(nome = "Barbeiro Teste", conn = getDb()) {
  const resultado = conn
    .prepare("INSERT INTO barbeiros (nome, ativo, ordem) VALUES (?, 1, 0)")
    .run(nome);
  return Number(resultado.lastInsertRowid);
}

/** Cria um agendamento mínimo direto no banco, para montar cenários de conflito. */
export function criarAgendamento(
  { barbeiroId, data, inicio, fim, status = "confirmado" },
  conn = getDb(),
) {
  const resultado = conn
    .prepare(
      `INSERT INTO agendamentos
        (cliente_nome, cliente_telefone, barbeiro_id, data, inicio, fim, status)
       VALUES ('Cliente Teste', '44999999999', ?, ?, ?, ?, ?)`,
    )
    .run(barbeiroId, data, inicio, fim, status);
  return Number(resultado.lastInsertRowid);
}

/** Cria um bloqueio direto no banco (barbeiroId null = afeta todo mundo). */
export function criarBloqueio(
  { barbeiroId = null, data, inicio, fim, motivo = "" },
  conn = getDb(),
) {
  const resultado = conn
    .prepare(
      "INSERT INTO bloqueios (barbeiro_id, data, inicio, fim, motivo) VALUES (?, ?, ?, ?, ?)",
    )
    .run(barbeiroId, data, inicio, fim, motivo);
  return Number(resultado.lastInsertRowid);
}

/**
 * Cria um barbeiro com login próprio já definido (senha real, hasheada).
 * `ativo` (visibilidade no site/relatórios) começa em 0 de propósito: este
 * helper serve para simular UMA SESSÃO autenticada nos testes de rota, sem
 * poluir listagens/relatórios que filtram por `ativo` — `login_ativo` (a
 * capacidade de entrar no painel) é uma coluna independente.
 */
export async function criarBarbeiroComLogin(
  {
    nome = "Barbeiro Teste",
    email = "barbeiro@teste.com",
    senha = "senha-de-teste-123",
    papel = "barbeiro",
    loginAtivo = 1,
    ativo = 0,
  } = {},
  conn = getDb(),
) {
  const resultado = conn
    .prepare(
      `INSERT INTO barbeiros (nome, email, senha_hash, papel, login_ativo, ativo, ordem)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      nome,
      email,
      await gerarHash(senha),
      papel,
      loginAtivo ? 1 : 0,
      ativo ? 1 : 0,
    );
  return Number(resultado.lastInsertRowid);
}

/** Monta uma Request mínima para chamar um route handler diretamente. */
export function requisicao(url, { method = "GET", body } = {}) {
  const init = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return new Request(url, init);
}
