import { sessaoClienteAtual } from "@/lib/cliente-auth";
import { comLog } from "@/lib/log";

export const dynamic = "force-dynamic";

// Pública por design (como GET /api/admin/sessao): responde 200 com
// { autenticado: false } em vez de 401, para o frontend decidir a tela.
export const GET = comLog("GET /api/conta/sessao", async () => {
  const sessao = sessaoClienteAtual();
  if (!sessao) {
    return Response.json({ autenticado: false });
  }
  return Response.json({
    autenticado: true,
    cliente: {
      nome: sessao.nome,
      email: sessao.email,
      telefone: sessao.telefone,
    },
  });
});
