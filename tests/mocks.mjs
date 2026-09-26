const real = globalThis.fetch;
import {appendFileSync} from 'node:fs';
globalThis.fetch = async (url,options) => {
  const host = new URL(url).host;
  if(host === 'api.telegram.org') {
    const method=new URL(url).pathname.split('/').at(-1);
    if(process.env.TEST_CALLS && ['sendRichMessage','sendDocument','answerCallbackQuery','setMyCommands','setChatMenuButton','setWebhook'].includes(method)){
      let body=options.body;
      if(body instanceof FormData){
        body={};
        for(const [key,value] of options.body.entries())body[key]=value instanceof Blob?{name:value.name||'',type:value.type,text:await value.text()}:value;
      }else if(typeof body==='string')body=JSON.parse(body);
      appendFileSync(process.env.TEST_CALLS,JSON.stringify({method,body})+'\n');
    }
    if(method==='getMe')return Response.json({ok:true,result:{username:'mdtxtrt_test_bot'}});
    return Response.json({ok:true,result:{message_id:42}});
  }
  if(host === 'api.telegra.ph') {
    const method = new URL(url).pathname.slice(1);
    const data = new URLSearchParams(options.body);
    if(process.env.TEST_CALLS)appendFileSync(process.env.TEST_CALLS,JSON.stringify({method,body:Object.fromEntries(data)})+'\n');
    if(method === 'createAccount') return Response.json({ok:true,result:{access_token:'persistent-test-token'}});
    if(method === 'getPage'){
      const path=data.get('path');
      return Response.json({ok:true,result:{url:'https://telegra.ph/'+path,path,content:[]}});
    }
    if(data.get('access_token') !== 'persistent-test-token') return Response.json({ok:false,error:'invalid token'},{status:401});
    if(method === 'getAccountInfo')return Response.json({ok:true,result:{short_name:'MDTXTRT',page_count:1}});
    const path = method === 'createPage' ? 'test-page-09-26' : data.get('path');
    return Response.json({ok:true,result:{url:'https://telegra.ph/'+path,path}});
  }
  return real(url,options);
};
