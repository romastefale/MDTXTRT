// Entrada do servidor: carrega a configuração, os módulos de server/ e sobe o HTTP.
import { PORT } from "./server/config.mjs";
import { sweepHandoffs } from "./server/storage.mjs";
import { ensureTelegraphToken, telegraphCall } from "./server/telegraph.mjs";
import { configureBot } from "./server/bot.mjs";
import { server } from "./server/routes.mjs";

async function start(){
  sweepHandoffs();
  await configureBot();
  const token=await ensureTelegraphToken();
  await telegraphCall("getAccountInfo",{access_token:token,fields:'["short_name","page_count"]'});
  console.log("Telegraph ready");
  server.listen(PORT,"0.0.0.0",()=>console.log(`MDTXTRT on ${PORT}`));
}
start().catch(error=>{
  console.error("MDTXTRT startup",error);
  process.exitCode=1;
});
