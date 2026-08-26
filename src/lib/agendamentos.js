// Criação, remarcação e mudança de status de agendamento, unificadas entre
// os fluxos que existiam duplicados com regras divergentes: público (cliente
// marcando pelo site) e painel (barbeiro encaixando na régua). As diferenças
// legítimas entre eles viram parâmetros (origem), não código separado.
import { getDb, lerConfig } from "./db.js";
import { agora, horariosLivres, paraHora, paraMinutos } from "./slots.js";
import { somenteDigitos, telefoneValido } from "./format.js";
import { validar } from "./validacao.js";
import { registrarAuditoria, snapshotAgendamento } from "./auditoria.js";

function erro(status, mensagem) {
  return { ok: false, status, erro: mensagem };
}

const MENSAGEM_CONFLITO_PADRAO =
  "Esse horário já está ocupado. Escolha outro, por favor.";

/** Lançada dentro de uma transação para abortar a gravação com uma mensagem amigável. */
class ErroAgendamento extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

/** Traduz o que veio de dentro da transação (ErroAgendamento ou violação de constraint) em `{ ok, status, erro }`. */
function tratarErroTransacao(e) {
  if (e instanceof ErroAgendamento) return erro(e.status, e.message);
  if (String(e?.code ?? "").startsWith("SQLITE_CONSTRAINT")) {
    // Rede de segurança: mesmo com a checagem acima já ter revalidado o
    // conflito por dentro da transação, o índice único parcial (Etapa 2) é
    // quem garante isso de verdade — se ele disparar, é conflito, não bug.
    return erro(409, MENSAGEM_CONFLITO_PADRAO);
  }
  throw e;
}

/**
 * Confere se { barbeiro, data, inicio, fim } colide com algo — lança
 * ErroAgendamento se sim. Chamada de dentro de uma transação BEGIN IMMEDIATE
 * (ver criarAgendamento/remarcarAgendamento/mudarStatusAgendamento), depois
 * do write lock já garantido: sem isso, a "atomicidade" seria um acidente de
 * runtime (só vale por não haver `await` entre checar e gravar), que some
 * com múltiplos processos ou com um `await` inserido numa manutenção futura.
 *
 * `origem: 'publico'` respeita expediente e antecedência mínima (via
 * horariosLivres); `origem: 'painel'` permite encaixe fora do expediente,
 * mas nunca sobre outro atendimento ou bloqueio. `ignorarId` exclui o
 * próprio agendamento da checagem (remarcação e reabertura de cancelado).
 */
function verificarConflito(
  conn,
  { origem, barbeiro, data, inicio, fim, duracaoMin, ignorarId },
) {
  if (origem === "publico") {
    const livres = horariosLivres({
      barbeiroId: barbeiro.id,
      duracaoMin,
      data,
    });
    if (!livres.includes(inicio)) {
      throw new ErroAgendamento(
        409,
        "Esse horário acabou de ser ocupado. Escolha outro, por favor.",
      );
    }
    return;
  }

  const condicaoIgnorar = ignorarId ? "AND id <> ?" : "";
  const paramsIgnorar = ignorarId ? [ignorarId] : [];

  const conflitoAgendamento = conn
    .prepare(
      `SELECT cliente_nome, inicio, fim FROM agendamentos
       WHERE data = ? AND barbeiro_id = ? AND status <> 'cancelado' AND excluido_em IS NULL ${condicaoIgnorar}
         AND inicio < ? AND fim > ?`,
    )
    .get(data, barbeiro.id, ...paramsIgnorar, fim, inicio);
  if (conflitoAgendamento) {
    throw new ErroAgendamento(
      409,
      `${barbeiro.nome} já atende ${conflitoAgendamento.cliente_nome} das ${conflitoAgendamento.inicio} às ${conflitoAgendamento.fim}.`,
    );
  }

  const conflitoBloqueio = conn
    .prepare(
      `SELECT motivo, inicio, fim FROM bloqueios
       WHERE data = ? AND (barbeiro_id IS NULL OR barbeiro_id = ?)
         AND inicio < ? AND fim > ?`,
    )
    .get(data, barbeiro.id, fim, inicio);
  if (conflitoBloqueio) {
    throw new ErroAgendamento(
      409,
      `${barbeiro.nome} está bloqueado (${conflitoBloqueio.motivo || "ausência"}) das ${conflitoBloqueio.inicio} às ${conflitoBloqueio.fim}.`,
    );
  }
}

/**
 * Cria um agendamento. Devolve `{ ok: true, id, agendamento }` ou
 * `{ ok: false, status, erro }` — quem chama decide como isso vira Response.
 *
 * origem: 'publico' | 'painel'
 *   - publico: respeita expediente e antecedência mínima; telefone
 *     obrigatório (10–11 dígitos); status inicial segue confirmacao_automatica.
 *   - painel: permite encaixe fora do expediente, mas nunca sobre outro
 *     atendimento ou bloqueio; telefone opcional, mas validado quando
 *     informado; entra sempre como 'confirmado'.
 */
export function criarAgendamento({
  origem,
  clienteNome,
  clienteTelefone,
  barbeiroId,
  servicoId,
  data,
  inicio,
  observacoes = "",
}) {
  const conn = getDb();

  const servico = conn
    .prepare("SELECT * FROM servicos WHERE id = ?")
    .get(servicoId);
  const barbeiro = conn
    .prepare("SELECT * FROM barbeiros WHERE id = ?")
    .get(barbeiroId);
  if (!servico || !barbeiro) {
    return erro(404, "Serviço ou profissional não encontrado.");
  }
  if (!servico.ativo) return erro(400, "Esse serviço está desativado.");
  if (!barbeiro.ativo) return erro(400, "Esse profissional está desativado.");

  const atende = conn
    .prepare(
      "SELECT 1 FROM servico_barbeiro WHERE servico_id = ? AND barbeiro_id = ?",
    )
    .get(servico.id, barbeiro.id);
  if (!atende) {
    return erro(400, `${barbeiro.nome} não atende ${servico.nome}.`);
  }

  const nome = String(clienteNome ?? "")
    .trim()
    .slice(0, 80);
  if (nome.length < 2) return erro(400, "Escreva o nome do cliente.");

  const telefone = somenteDigitos(clienteTelefone);
  if (origem === "publico" && !telefoneValido(telefone)) {
    return erro(400, "Informe um WhatsApp com DDD.");
  }
  if (origem === "painel" && telefone && !telefoneValido(telefone)) {
    return erro(
      400,
      "Telefone inválido — informe DDD + número, ou deixe em branco.",
    );
  }

  const { ok: dataHoraOk } = validar("agendamentos", { data, inicio });
  if (!dataHoraOk) return erro(400, "Informe a data e o horário.");

  const fim = paraHora(paraMinutos(inicio) + servico.duracao_min);
  const status =
    origem === "publico"
      ? lerConfig().confirmacao_automatica === "1"
        ? "confirmado"
        : "pendente"
      : "confirmado";
  const observacoesLimpas = String(observacoes ?? "")
    .trim()
    .slice(0, 300);

  const executarInsercao = conn.transaction(() => {
    verificarConflito(conn, {
      origem,
      barbeiro,
      data,
      inicio,
      fim,
      duracaoMin: servico.duracao_min,
    });
    const resultado = conn
      .prepare(
        `INSERT INTO agendamentos
          (cliente_nome, cliente_telefone, barbeiro_id, servico_id, barbeiro_nome, servico_nome,
           data, inicio, fim, duracao_min, preco_centavos, observacoes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nome,
        telefone,
        barbeiro.id,
        servico.id,
        barbeiro.nome,
        servico.nome,
        data,
        inicio,
        fim,
        servico.duracao_min,
        servico.preco_centavos,
        observacoesLimpas,
        status,
      );
    registrarAuditoria(conn, {
      acao: "criar",
      tabela: "agendamentos",
      registroId: Number(resultado.lastInsertRowid),
      depois: snapshotAgendamento({
        barbeiro_id: barbeiro.id,
        servico_id: servico.id,
        data,
        inicio,
        fim,
        status,
        preco_centavos: servico.preco_centavos,
      }),
    });
    return resultado;
  });

  let resultado;
  try {
    resultado = executarInsercao.immediate();
  } catch (e) {
    return tratarErroTransacao(e);
  }

  const id = Number(resultado.lastInsertRowid);
  return {
    ok: true,
    id,
    agendamento: {
      id,
      cliente: nome,
      telefone,
      barbeiro: barbeiro.nome,
      servico: servico.nome,
      data,
      inicio,
      fim,
      duracao_min: servico.duracao_min,
      preco_centavos: servico.preco_centavos,
      observacoes: observacoesLimpas,
      status,
    },
  };
}

/**
 * Remarca um agendamento existente: troca data/horário e, se enviados,
 * barbeiro e/ou serviço — reaproveitando a mesma checagem de conflito e a
 * mesma transação da criação. Os campos derivados (fim, duracao_min,
 * preco_centavos, barbeiro_nome, servico_nome) são recalculados como
 * snapshot do serviço/profissional no momento da remarcação, seguindo a
 * mesma política já usada na criação.
 */
export function remarcarAgendamento(
  id,
  { data, inicio, barbeiroId, servicoId },
) {
  const conn = getDb();

  const atual = conn
    .prepare("SELECT * FROM agendamentos WHERE id = ? AND excluido_em IS NULL")
    .get(id);
  if (!atual) return erro(404, "Agendamento não encontrado.");
  if (atual.status === "concluido" || atual.status === "cancelado") {
    return erro(400, `Não é possível remarcar um agendamento ${atual.status}.`);
  }

  const novoBarbeiroId =
    barbeiroId !== undefined ? Number(barbeiroId) : atual.barbeiro_id;
  const novoServicoId =
    servicoId !== undefined ? Number(servicoId) : atual.servico_id;
  const novaData = data !== undefined ? String(data) : atual.data;
  const novoInicio = inicio !== undefined ? String(inicio) : atual.inicio;

  const servico = conn
    .prepare("SELECT * FROM servicos WHERE id = ?")
    .get(novoServicoId);
  const barbeiro = conn
    .prepare("SELECT * FROM barbeiros WHERE id = ?")
    .get(novoBarbeiroId);
  if (!servico || !barbeiro)
    return erro(404, "Serviço ou profissional não encontrado.");
  if (!servico.ativo) return erro(400, "Esse serviço está desativado.");
  if (!barbeiro.ativo) return erro(400, "Esse profissional está desativado.");

  const atende = conn
    .prepare(
      "SELECT 1 FROM servico_barbeiro WHERE servico_id = ? AND barbeiro_id = ?",
    )
    .get(servico.id, barbeiro.id);
  if (!atende) return erro(400, `${barbeiro.nome} não atende ${servico.nome}.`);

  const { ok: dataHoraOk } = validar("agendamentos", {
    data: novaData,
    inicio: novoInicio,
  });
  if (!dataHoraOk) return erro(400, "Informe a data e o horário.");

  const novoFim = paraHora(paraMinutos(novoInicio) + servico.duracao_min);

  const executarUpdate = conn.transaction(() => {
    verificarConflito(conn, {
      origem: "painel",
      barbeiro,
      data: novaData,
      inicio: novoInicio,
      fim: novoFim,
      ignorarId: id,
    });
    conn
      .prepare(
        `UPDATE agendamentos SET
           barbeiro_id = ?, servico_id = ?, barbeiro_nome = ?, servico_nome = ?,
           data = ?, inicio = ?, fim = ?, duracao_min = ?, preco_centavos = ?
         WHERE id = ?`,
      )
      .run(
        barbeiro.id,
        servico.id,
        barbeiro.nome,
        servico.nome,
        novaData,
        novoInicio,
        novoFim,
        servico.duracao_min,
        servico.preco_centavos,
        id,
      );
    registrarAuditoria(conn, {
      acao: "remarcar",
      tabela: "agendamentos",
      registroId: id,
      antes: snapshotAgendamento(atual),
      depois: snapshotAgendamento({
        barbeiro_id: barbeiro.id,
        servico_id: servico.id,
        data: novaData,
        inicio: novoInicio,
        fim: novoFim,
        status: atual.status,
        preco_centavos: servico.preco_centavos,
      }),
    });
  });

  try {
    executarUpdate.immediate();
  } catch (e) {
    return tratarErroTransacao(e);
  }

  return { ok: true };
}

// pendente→confirmado|cancelado; confirmado→concluido|cancelado;
// concluido→(nenhuma); cancelado→pendente|confirmado (revalidando o
// horário, já que ele pode ter sido ocupado por outra pessoa enquanto este
// agendamento estava cancelado).
const TRANSICOES_LEGAIS = {
  pendente: ["confirmado", "cancelado"],
  confirmado: ["concluido", "cancelado"],
  concluido: [],
  cancelado: ["pendente", "confirmado"],
};

const STATUS_VALIDOS = Object.keys(TRANSICOES_LEGAIS);

/**
 * Muda o status de um agendamento, só permitindo transições legais.
 * Cenário que isso evita: cliente cancela → o horário volta a ser
 * oferecido → outro cliente marca → o barbeiro clica em "Confirmar" na
 * linha do cancelado → dois agendamentos confirmados no mesmo horário.
 */
export function mudarStatusAgendamento(id, novoStatus) {
  if (!STATUS_VALIDOS.includes(novoStatus)) {
    return erro(400, "Status inválido.");
  }

  const conn = getDb();
  const atual = conn
    .prepare("SELECT * FROM agendamentos WHERE id = ? AND excluido_em IS NULL")
    .get(id);
  if (!atual) return erro(404, "Agendamento não encontrado.");

  if (!(TRANSICOES_LEGAIS[atual.status] || []).includes(novoStatus)) {
    return erro(
      400,
      `Não é possível mudar de "${atual.status}" para "${novoStatus}".`,
    );
  }

  if (novoStatus === "concluido" && atual.data > agora().data) {
    return erro(400, "Não é possível concluir um agendamento com data futura.");
  }

  const executarUpdate = conn.transaction(() => {
    if (atual.status === "cancelado") {
      verificarConflito(conn, {
        origem: "painel",
        barbeiro: { id: atual.barbeiro_id, nome: atual.barbeiro_nome },
        data: atual.data,
        inicio: atual.inicio,
        fim: atual.fim,
        ignorarId: id,
      });
    }
    conn
      .prepare("UPDATE agendamentos SET status = ? WHERE id = ?")
      .run(novoStatus, id);
    registrarAuditoria(conn, {
      acao: "status",
      tabela: "agendamentos",
      registroId: id,
      antes: { status: atual.status },
      depois: { status: novoStatus },
    });
  });

  try {
    executarUpdate.immediate();
  } catch (e) {
    return tratarErroTransacao(e);
  }

  return { ok: true };
}

/**
 * Exclusão lógica: marca `excluido_em` em vez de apagar a linha — o
 * Financeiro é derivado 100% dessa tabela, e o painel usa uma senha
 * compartilhada por toda a equipe, então apagar de verdade destruiria o
 * único registro de quem fez o quê. Todas as leituras (horariosLivres,
 * relatórios, listagens) já filtram `excluido_em IS NULL`.
 */
export function excluirAgendamento(id) {
  const conn = getDb();
  const atual = conn
    .prepare("SELECT * FROM agendamentos WHERE id = ? AND excluido_em IS NULL")
    .get(id);
  if (!atual) return erro(404, "Agendamento não encontrado.");

  const executarExclusao = conn.transaction(() => {
    conn
      .prepare(
        "UPDATE agendamentos SET excluido_em = datetime('now') WHERE id = ?",
      )
      .run(id);
    registrarAuditoria(conn, {
      acao: "excluir",
      tabela: "agendamentos",
      registroId: id,
      antes: snapshotAgendamento(atual),
    });
  });

  executarExclusao();
  return { ok: true };
}
