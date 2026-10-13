// Entrada do Railway: `node --import ./railway/register.mjs server.mjs` (ver railway.json).
import { main } from './railway/server.mjs';

main().catch((error) => {
  console.error('MDTXTRT startup', error);
  process.exitCode = 1;
});
