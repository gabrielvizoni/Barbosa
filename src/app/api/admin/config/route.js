import { exigirSessao, modoBootstrap } from "@/lib/auth";
import { getDb, lerConfig, salvarConfig } from "@/lib/db";
import { FUSO } from "@/lib/slots";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog } from "@/lib/log";
import { registrarAuditoria } from "@/lib/auditoria";

export const dynamic = "force-dynamic";

const CHAVES = [
  "nome_barbearia",
  "slogan",
  "whatsapp",
  "endereco",
  "instagram",
  "logo_url",
  "intervalo_min",
  "antecedencia_min",
  "dias_futuros",
  "confirmacao_automatica",
  // Autodeclaração do checklist de primeiros passos (Etapa 9 da auditoria):
  // "conferir o expediente" não dá pra inferir dos dados, só o próprio
  // dono sabe se já olhou — fica marcado quando ele confirma na tela.
  "onboarding_expediente_ok",
];

/** Nunca saem para o navegador: o hash da senha e o controle de sessões. */
const INTERNAS = ["senha_hash", "sessao_versao"];

function configPublica() {
  const config = lerConfig();
  for (const chave of INTERNAS) delete config[chave];
  return config;
}

export const GET = comLog("GET /api/admin/config", async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;
  return Response.json({
    config: configPublica(),
    modoBootstrap: modoBootstrap(),
    fuso: FUSO,
  });
});

export const PUT = comLog("PUT /api/admin/config", async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: "JSON inválido." }, { status: 400 });
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
        acao: "salvar",
        tabela: "config",
        antes: Object.fromEntries(Object.keys(pares).map((c) => [c, antes[c]])),
        depois: pares,
      });
    }
  }

  return Response.json({ config: configPublica() });
});
