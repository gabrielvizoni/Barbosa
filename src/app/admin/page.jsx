import { lerConfig } from '@/lib/db';
import { NOME_PADRAO } from '@/lib/format';
import PainelAdmin from './PainelAdmin';

export async function generateMetadata() {
  const config = lerConfig();
  return {
    title: `Painel — ${config.nome_barbearia || NOME_PADRAO}`,
    robots: { index: false, follow: false },
  };
}

export default function PaginaAdmin() {
  return <PainelAdmin />;
}
