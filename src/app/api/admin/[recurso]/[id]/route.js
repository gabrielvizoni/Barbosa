import { exigirSessao } from '@/lib/auth';
import { getDb, definirBarbeirosDoServico } from '@/lib/db';
import { filtrarCampos, obterRecurso } from '../route';
import { primeiroErro, validar } from '@/lib/validacao';
import { lerCorpoJson } from '@/lib/requisicao';
import { comLog } from '@/lib/log';

export const dynamic = 'force-dynamic';

export const PATCH = comLog('PATCH /api/admin/[recurso]/[id]', async (request, { params }) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const recurso = obterRecurso(params.recurso);
  const id = Number(params.id);
  if (!recurso || !id) {
    return Response.json({ erro: 'Item não encontrado.' }, { status: 404 });
  }

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }
  const campos = filtrarCampos(recurso, corpo);
  const colunas = Object.keys(campos);

  if (colunas.length === 0) {
    return Response.json({ erro: 'Nada para salvar.' }, { status: 400 });
  }

  const { ok, erros } = validar(params.recurso, campos);
  if (!ok) {
    return Response.json({ erro: primeiroErro(erros), erros }, { status: 400 });
  }

  const resultado = getDb()
    .prepare(
      `UPDATE ${recurso.tabela} SET ${colunas.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`
    )
    .run(...colunas.map((c) => campos[c]), id);

  if (resultado.changes === 0) {
    return Response.json({ erro: 'Item não encontrado.' }, { status: 404 });
  }

  if (params.recurso === 'servicos' && Array.isArray(corpo.barbeiros)) {
    definirBarbeirosDoServico(id, corpo.barbeiros);
  }

  return Response.json({ ok: true });
});

export const DELETE = comLog('DELETE /api/admin/[recurso]/[id]', async (request, { params }) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const recurso = obterRecurso(params.recurso);
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
      const resultado = getDb().prepare(`UPDATE ${recurso.tabela} SET ativo = 0 WHERE id = ?`).run(id);
      if (resultado.changes === 0) {
        return Response.json({ erro: 'Item não encontrado.' }, { status: 404 });
      }
      return Response.json({
        ok: true,
        desativado: true,
        mensagem:
          'Tem histórico de atendimento, então foi desativado em vez de excluído. Some do site e do agendamento.',
      });
    }
  }

  const resultado = getDb().prepare(`DELETE FROM ${recurso.tabela} WHERE id = ?`).run(id);
  if (resultado.changes === 0) {
    return Response.json({ erro: 'Item não encontrado.' }, { status: 404 });
  }

  return Response.json({ ok: true });
});
