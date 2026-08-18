import { exigirSessao } from '@/lib/auth';
import { getDb, definirBarbeirosDoServico } from '@/lib/db';
import { RECURSOS, filtrarCampos } from '../route';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const negado = exigirSessao();
  if (negado) return negado;

  const recurso = RECURSOS[params.recurso];
  const id = Number(params.id);
  if (!recurso || !id) {
    return Response.json({ erro: 'Item não encontrado.' }, { status: 404 });
  }

  const corpo = await request.json().catch(() => ({}));
  const campos = filtrarCampos(recurso, corpo);
  const colunas = Object.keys(campos);

  if (colunas.length > 0) {
    getDb()
      .prepare(
        `UPDATE ${recurso.tabela} SET ${colunas.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`
      )
      .run(...colunas.map((c) => campos[c]), id);
  }

  if (params.recurso === 'servicos' && Array.isArray(corpo.barbeiros)) {
    definirBarbeirosDoServico(id, corpo.barbeiros);
  }

  return Response.json({ ok: true });
}

export async function DELETE(_request, { params }) {
  const negado = exigirSessao();
  if (negado) return negado;

  const recurso = RECURSOS[params.recurso];
  const id = Number(params.id);
  if (!recurso || !id) {
    return Response.json({ erro: 'Item não encontrado.' }, { status: 404 });
  }

  // Um profissional ou serviço com histórico não some: fica desativado,
  // para que os agendamentos antigos continuem fazendo sentido no financeiro.
  if (params.recurso === 'barbeiros' || params.recurso === 'servicos') {
    const coluna = params.recurso === 'barbeiros' ? 'barbeiro_id' : 'servico_id';
    const usos = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM agendamentos WHERE ${coluna} = ?`)
      .get(id).n;

    if (usos > 0) {
      getDb().prepare(`UPDATE ${recurso.tabela} SET ativo = 0 WHERE id = ?`).run(id);
      return Response.json({
        ok: true,
        desativado: true,
        mensagem:
          'Tem histórico de atendimento, então foi desativado em vez de excluído. Some do site e do agendamento.',
      });
    }
  }

  getDb().prepare(`DELETE FROM ${recurso.tabela} WHERE id = ?`).run(id);
  return Response.json({ ok: true });
}
