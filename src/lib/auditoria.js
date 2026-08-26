// Registro de quem mudou o quê — necessário porque o painel usa uma única
// senha compartilhada por toda a equipe, então não há usuário individual
// para responsabilizar. `antes`/`depois` guardam só campos operacionais
// (status, data, horário, ids, preço): nunca nome ou telefone do cliente.

/** Grava uma linha de auditoria. Chame de DENTRO da mesma transação da mutação que registra. */
export function registrarAuditoria(
  conn,
  { acao, tabela, registroId = null, antes = null, depois = null },
) {
  conn
    .prepare(
      `INSERT INTO auditoria (acao, tabela, registro_id, antes, depois) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      acao,
      tabela,
      registroId,
      antes ? JSON.stringify(antes) : null,
      depois ? JSON.stringify(depois) : null,
    );
}

/** Retrato de um agendamento sem nenhum dado do cliente, para o par antes/depois da auditoria. */
export function snapshotAgendamento(a) {
  return {
    barbeiro_id: a.barbeiro_id,
    servico_id: a.servico_id,
    data: a.data,
    inicio: a.inicio,
    fim: a.fim,
    status: a.status,
    preco_centavos: a.preco_centavos,
  };
}
