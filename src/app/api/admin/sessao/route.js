import {
  autenticacaoConfiguradaComSeguranca,
  modoBootstrap,
  sessaoAtual,
} from "@/lib/auth";
import { comLog } from "@/lib/log";

export const dynamic = "force-dynamic";

export const GET = comLog("GET /api/admin/sessao", async () => {
  if (!autenticacaoConfiguradaComSeguranca()) {
    return Response.json({ autenticado: false, configuracaoInsegura: true });
  }

  const sessao = sessaoAtual();
  if (!sessao) {
    // O frontend precisa saber isso mesmo deslogado, para escolher entre a
    // tela normal de login (e-mail + senha) e a de bootstrap (só senha).
    return Response.json({
      autenticado: false,
      modoBootstrap: modoBootstrap(),
    });
  }

  if (sessao.tipo === "bootstrap") {
    return Response.json({ autenticado: true, modoBootstrap: true });
  }

  return Response.json({
    autenticado: true,
    modoBootstrap: false,
    barbeiro: {
      id: sessao.barbeiroId,
      nome: sessao.nome,
      email: sessao.email,
      papel: sessao.papel,
    },
  });
});
