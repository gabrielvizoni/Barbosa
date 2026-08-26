// Aplica as migrations pendentes em DATABASE_PATH (ou ./data/barbosa.db).
// Rode antes da primeira vez que subir o servidor, e de novo sempre que uma
// migration nova for adicionada a src/lib/migrations.js.
//
//   npm run migrate
import { abrirConexao } from '../src/lib/db.js';
import { aplicarMigrations, versaoDoBanco, versaoEsperada } from '../src/lib/migrations.js';

const conn = abrirConexao();
const antes = versaoDoBanco(conn);
const aplicadas = aplicarMigrations(conn);
conn.close();

if (aplicadas.length === 0) {
  console.log(`Banco já está atualizado (versão ${antes}).`);
} else {
  for (const migration of aplicadas) {
    console.log(`✓ Migration ${migration.versao} — ${migration.descricao}`);
  }
  console.log(`Banco atualizado: versão ${antes} → ${versaoEsperada()}.`);
}
