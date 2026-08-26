// Worker usado só por tests/concorrencia.test.js: chama criarAgendamento()
// numa thread própria, com sua própria conexão SQLite ao mesmo arquivo do
// processo principal — é a única forma de testar de verdade que a
// transação BEGIN IMMEDIATE (ver src/lib/agendamentos.js) serializa duas
// tentativas de reserva simultâneas em vez de deixar as duas passarem.
import { parentPort, workerData } from 'node:worker_threads';

process.env.DATABASE_PATH = workerData.databasePath;

const { criarAgendamento } = await import('../src/lib/agendamentos.js');
const resultado = criarAgendamento(workerData.parametros);
parentPort.postMessage(resultado);
