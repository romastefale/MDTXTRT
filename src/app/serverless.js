import { getTg } from "./theme.js";

// Chamada a um endpoint do Telegram Serverless (Telegram.WebApp.Serverless.call).
// A plataforma envia e valida o initData; o erro traz type, status e parameters.
export function call(name,input={}){
  return new Promise((resolve,reject)=>{
    const serverless=getTg()?.Serverless;
    if(!serverless||typeof serverless.call!=='function'){reject(new Error('Abra pelo bot no Telegram'));return;}
    serverless.call(name,input,(error,result)=>{
      if(error){
        const failure=new Error(error.message||'Falha na chamada ao Telegram');
        failure.type=error.type;failure.status=error.status;failure.parameters=error.parameters;
        failure.code=error.parameters?.code;
        reject(failure);
        return;
      }
      resolve(result);
    });
  });
}
