const real = globalThis.fetch;
import {appendFileSync} from 'node:fs';

globalThis.fetch = async (url,options={}) => {
  const parsed=new URL(url);
  if(parsed.host==='api.telegram.org'){
    const method=parsed.pathname.split('/').at(-1);
    if(process.env.TEST_CALLS&&['sendRichMessage','sendDocument','answerCallbackQuery','setMyCommands','setChatMenuButton','setWebhook'].includes(method)){
      let body=options.body;
      if(body instanceof FormData){
        body={};
        for(const [key,value] of options.body.entries())body[key]=value instanceof Blob?{name:value.name||'',type:value.type,text:await value.text()}:value;
      }else if(typeof body==='string')body=JSON.parse(body);
      appendFileSync(process.env.TEST_CALLS,JSON.stringify({method,body})+'\n');
    }
    if(method==='getMe')return Response.json({ok:true,result:{username:'mdtxtrt_test_bot'}});
    if(method==='sendRichMessage'&&typeof options.body==='string'){
      const probe=JSON.parse(options.body);
      if(probe.rich_message?.html?.includes('UPSTREAM_REJECT'))return Response.json({ok:false,description:'test rejection'},{status:400});
    }
    return Response.json({ok:true,result:{message_id:42}});
  }
  if(parsed.host==='api.telegra.ph'){
    const method=parsed.pathname.slice(1);
    const data=new URLSearchParams(options.body);
    if(process.env.TEST_CALLS)appendFileSync(process.env.TEST_CALLS,JSON.stringify({method,body:Object.fromEntries(data)})+'\n');
    if(method==='createAccount')return Response.json({ok:true,result:{access_token:'persistent-test-token'}});
    if(method==='getPage'){
      const path=data.get('path');
      return Response.json({ok:true,result:{url:'https://telegra.ph/'+path,path,content:[]}});
    }
    if(data.get('access_token')!=='persistent-test-token')return Response.json({ok:false,error:'invalid token'},{status:401});
    if(method==='getAccountInfo')return Response.json({ok:true,result:{short_name:'MDTXTRT',page_count:1}});
    if(['createPage','editPage'].includes(method)&&data.get('title')==='UPSTREAM_REJECT')return Response.json({ok:false,error:'test rejection'},{status:400});
    const path=method==='createPage'?'test-page-regression':data.get('path');
    return Response.json({ok:true,result:{url:'https://telegra.ph/'+path,path}});
  }
  return real(url,options);
};
