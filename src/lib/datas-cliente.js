// Cálculo de "hoje" no fuso da barbearia, para uso no navegador.
//
// O backend já calcula isso certo (agora() em src/lib/slots.js, usando a env
// TZ), mas slots.js importa getDb() — um módulo nativo do Node que não roda
// no navegador. Este arquivo espelha a mesma técnica (Intl.DateTimeFormat
// com timeZone explícito, não o relógio local do aparelho) só que recebendo
// o fuso por parâmetro, já que o cliente não tem acesso à env do servidor —
// ele vem da API (/api/public e GET /api/admin/config).
//
// Não duplica formatação de rótulo (nome do mês, dia da semana etc.) — isso
// já existe em cada tela que precisa.

/**
 * "AAAA-MM-DD" de hoje no fuso informado — não no fuso do navegador.
 * `momento` é o instante a converter (default: agora) — parametrizado para
 * dar para testar o horário de virada sem depender do relógio real.
 */
export function hojeLocal(fuso, momento = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const partes = Object.fromEntries(
    fmt.formatToParts(momento).map((p) => [p.type, p.value]),
  );
  return `${partes.year}-${partes.month}-${partes.day}`;
}

/** "AAAA-MM" do mês atual no fuso informado. */
export function mesAtualLocal(fuso, momento = new Date()) {
  return hojeLocal(fuso, momento).slice(0, 7);
}
