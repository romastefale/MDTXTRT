import { getTg } from "./theme.js";

// Backend: o Telegram Serverless (tgcloud) ou, quando o Mini App é servido pelo Railway,
// a API HTTP do mesmo servidor. As duas rotas chamam os mesmos endpoints de tgcloud/endpoints.

function failure(error,fallback){
  const e=new Error(error?.message||fallback);
  e.type=error?.type;e.status=error?.status;e.parameters=error?.parameters;
  e.code=error?.parameters?.code;
  return e;
}

// Chamada via Telegram.WebApp.Serverless.call: a plataforma envia e valida o initData.
function viaServerless(serverless,name,input){
  return new Promise((resolve,reject)=>{
    serverless.call(name,input,(error,result)=>{
      if(error){reject(failure(error,'Falha na chamada ao Telegram'));return;}
      resolve(result);
    });
  });
}

// Chamada via HTTP ao servidor do Railway (mesma origem do Mini App): o servidor valida o initData.
async function viaHttp(name,input,initData,unload=false){
  let res;
  const body=JSON.stringify({initData,input});
  const bytes=new Blob([body]).size;
  const url=new URL('api/call/'+encodeURIComponent(name),document.baseURI);
  // Ao fechar a página só sendBeacon garante o envio; a resposta não existe, então devolve {queued:true}.
  if(unload&&bytes<60000&&typeof navigator.sendBeacon==='function'&&navigator.sendBeacon(url,new Blob([body],{type:'application/json'})))return {queued:true};
  try{
    res=await fetch(url,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body,
      // keepalive deixa o salvamento ao fechar a página terminar (limite de 64 KB do navegador).
      keepalive:bytes<60000,
      signal:AbortSignal.timeout(130000)
    });
  }catch{
    throw new Error('Sem conexão com o servidor');
  }
  let json=null;
  try{json=await res.json();}catch{}
  if(!res.ok||!json?.ok)throw failure(json?.error||{status:res.status},'Falha na chamada ao servidor');
  return json.result;
}

// opções.unload: chamada feita ao fechar a página (só tem efeito na rota HTTP).
export function call(name,input={},options={}){
  const tg=getTg();
  if(!tg?.initData)return Promise.reject(new Error('Abra pelo bot no Telegram'));
  const serverless=tg.Serverless;
  if(serverless&&typeof serverless.call==='function')return viaServerless(serverless,name,input);
  return viaHttp(name,input,tg.initData,Boolean(options.unload));
}
