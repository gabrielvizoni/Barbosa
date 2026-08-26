import { exigirSessao, usandoSenhaInicial } from '@/lib/auth';
import { getDb, lerConfig, lerExpediente, salvarConfig, salvarExpediente } from '@/lib/db';
import { validarExpediente } from '@/lib/validacao';
import { FUSO } from '@/lib/slots';
import { lerCorpoJson } from '@/lib/requisicao';
import { comLog } from '@/lib/log';
import { registrarAuditoria } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';

const CHAVES = [
  'nome_barbearia',
  'slogan',
  'whatsapp',
  'endereco',
  'instagram',
  'logo_url',
  'intervalo_min',
  'antecedencia_min',
  'dias_futuros',
  'confirmacao_automatica',
];

/** Nunca saem para o navegador: o hash da senha e o controle de sessões. */
const INTERNAS = ['senha_hash', 'sessao_versao'];

function configPublica() {
  const config = lerConfig();
  for (const chave of INTERNAS) delete config[chave];
  return config;
}

export const GET = comLog('GET /api/admin/config', async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;
  return Response.json({
    config: configPublica(),
    expediente: lerExpediente(),
    senhaInicial: usandoSenhaInicial(),
    fuso: FUSO,
  });
});

export const PUT = comLog('PUT /api/admin/config', async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }

  if (corpo.config) {
    const pares = {};
    for (const chave of CHAVES) {
      if (chave in corpo.config) pares[chave] = corpo.config[chave];
    }
    if (Object.keys(pares).length) {
      const antes = lerConfig();
      salvarConfig(pares);
      registrarAuditoria(getDb(), {
        acao: 'salvar',
        tabela: 'config',
        antes: Object.fromEntries(Object.keys(pares).map((c) => [c, antes[c]])),
        depois: pares,
      });
    }
  }

  if (Array.isArray(corpo.expediente)) {
    const dias = corpo.expediente
      .filter((d) => Number.isInteger(Number(d.dia)))
      .map((d) => ({
        dia: Number(d.dia),
        aberto: d.aberto ? 1 : 0,
        abre: /^\d{2}:\d{2}$/.test(d.abre) ? d.abre : '09:00',
        fecha: /^\d{2}:\d{2}$/.test(d.fecha) ? d.fecha : '20:00',
      }));

    if (dias.length) {
      const { ok, erros } = validarExpediente(dias);
      if (!ok) {
        return Response.json(
          { erro: `Expediente inválido: ${erros.map((e) => e.mensagem).join(' ')}` },
          { status: 400 }
        );
      }
      salvarExpediente(dias);
    }
  }

  return Response.json({ config: configPublica(), expediente: lerExpediente() });
});
