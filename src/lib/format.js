/** Centavos -> "R$ 45,00" */
export function moeda(centavos) {
  return (Number(centavos || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/** "4599" digitado no admin -> centavos. Aceita "45,99", "45.99" e "45". */
export function paraCentavos(texto) {
  const limpo = String(texto ?? '').replace(/\s/g, '').replace(',', '.');
  const numero = Number(limpo);
  if (!Number.isFinite(numero)) return 0;
  return Math.round(numero * 100);
}

/** Centavos -> "45.00", pronto para preencher um <input type="number">. */
export function paraReais(centavos) {
  return (Number(centavos || 0) / 100).toFixed(2);
}

/** "AAAA-MM-DD" -> "24/08/2026" */
export function dataBr(data) {
  if (!data) return '';
  const [a, m, d] = data.split('-');
  return `${d}/${m}/${a}`;
}

/** Aplica a máscara (44) 99999-9999 enquanto a pessoa digita. */
export function mascararTelefone(valor) {
  const digitos = String(valor || '').replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 6) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
  if (digitos.length <= 10) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  }
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
}

export function somenteDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/** Telefone brasileiro válido: 10 ou 11 dígitos. */
export function telefoneValido(valor) {
  const d = somenteDigitos(valor);
  return d.length === 10 || d.length === 11;
}

/** Iniciais para o retrato de quem não tem foto. */
export function iniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '·';
  if (partes.length === 1) return partes[0][0].toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * Monta o link do WhatsApp com a mensagem de confirmação já escrita.
 * Sem número configurado, devolve null — a tela então esconde o botão.
 */
export function linkWhatsapp(numeroBarbearia, agendamento) {
  const numero = somenteDigitos(numeroBarbearia);
  if (!numero) return null;
  const completo = numero.startsWith('55') ? numero : `55${numero}`;

  const linhas = [
    `Olá! Acabei de agendar pelo site da ${agendamento.barbearia}.`,
    '',
    `Nome: ${agendamento.cliente}`,
    `Serviço: ${agendamento.servico}`,
    `Profissional: ${agendamento.barbeiro}`,
    `Data: ${dataBr(agendamento.data)} às ${agendamento.inicio}`,
    `Valor: ${moeda(agendamento.preco_centavos)}`,
  ];
  if (agendamento.observacoes) linhas.push(`Observações: ${agendamento.observacoes}`);
  linhas.push('', 'Pode confirmar pra mim?');

  return `https://wa.me/${completo}?text=${encodeURIComponent(linhas.join('\n'))}`;
}
