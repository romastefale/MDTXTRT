const real = globalThis.fetch;
import {appendFileSync,mkdirSync} from 'node:fs';

globalThis.fetch = async (url,options={}) => {
  const parsed=new URL(url);
  if(parsed.host==='api.telegram.org'){
    if(parsed.pathname.startsWith('/file/bot')){
      const id=parsed.pathname.split('/').at(-1);
      if(process.env.TEST_CALLS)appendFileSync(process.env.TEST_CALLS,JSON.stringify({method:'downloadFile',body:{path:parsed.pathname}})+'\n');
      if(id==='download-missing')return new Response('missing',{status:404});
      if(id==='download-network')throw new TypeError('simulated file download network failure');
      if(id==='valid-txt')return new Response(new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode('linha literal\r\n# continua literal\n')]),{status:200,headers:{'content-type':'application/octet-stream'}});
      if(id==='valid-md')return new Response(new TextEncoder().encode('# Título\n\n**forte** e ~~cortado~~\n\n<video src="https://example.com/video.mp4" controls></video>'),{status:200,headers:{'content-type':'application/octet-stream'}});
      if(id==='invalid-utf8')return new Response(new Uint8Array([0xc3,0x28]),{status:200});
      return new Response(new TextEncoder().encode('arquivo de teste'),{status:200});
    }
    const method=parsed.pathname.split('/').at(-1);
    if(process.env.TEST_CALLS&&['getFile','sendRichMessage','editMessageText','sendDocument','answerCallbackQuery','setMyCommands','deleteMyCommands','setChatMenuButton','setWebhook'].includes(method)){
      let body=options.body;
      if(body instanceof FormData){
        body={};
        for(const [key,value] of options.body.entries())body[key]=value instanceof Blob?{name:value.name||'',type:value.type,text:await value.text()}:value;
      }else if(typeof body==='string')body=JSON.parse(body);
      appendFileSync(process.env.TEST_CALLS,JSON.stringify({method,body})+'\n');
    }
    if(method==='getMe')return Response.json({ok:true,result:{username:'mdtxtrt_test_bot'}});
    if(method==='getFile'){
      const probe=typeof options.body==='string'?JSON.parse(options.body):{};
      if(probe.file_id==='getfile-reject')return Response.json({ok:false,description:'test getFile rejection'},{status:400});
      if(probe.file_id==='missing-path')return Response.json({ok:true,result:{file_id:probe.file_id,file_unique_id:'u-'+probe.file_id}});
      return Response.json({ok:true,result:{file_id:probe.file_id,file_unique_id:'u-'+probe.file_id,file_path:'documents/'+probe.file_id}});
    }
    if(['sendRichMessage','editMessageText'].includes(method)&&typeof options.body==='string'){
      const probe=JSON.parse(options.body);
      if(probe.rich_message?.html?.includes('UPSTREAM_TIMEOUT'))throw new TypeError('simulated transport timeout');
      if(probe.rich_message?.html?.includes('UPSTREAM_DELAY'))await new Promise(resolve=>setTimeout(resolve,150));
      if(probe.rich_message?.html?.includes('UPSTREAM_REJECT'))return Response.json({ok:false,description:'test rejection'},{status:400});
      if(probe.rich_message?.html?.includes('UPSTREAM_RATE_LIMIT'))return Response.json({ok:false,error_code:429,description:'Too Many Requests: retry after 7',parameters:{retry_after:7}},{status:429});
      if(probe.rich_message?.html?.includes('UPSTREAM_BLOCKED'))return Response.json({ok:false,error_code:403,description:'Forbidden: bot was blocked by the user'},{status:403});
      if(probe.rich_message?.html?.includes('UPSTREAM_NOT_STARTED'))return Response.json({ok:false,error_code:403,description:"Forbidden: bot can't initiate conversation with a user"},{status:403});
      if(method==='sendRichMessage'){
        const html=String(probe.rich_message?.html||'');
        if(html.includes('Atualização de publicação'))return Response.json({ok:true,result:{message_id:43}});
        if(probe.reply_parameters?.message_id)return Response.json({ok:true,result:{message_id:44}});
      }
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
      // Formato observado no getPage real: id em títulos, target em links,
      // arquivos hospedados com caminho relativo e links internos.
      if(path==='live-shape-page')return Response.json({ok:true,result:{url:'https://telegra.ph/'+path,path,title:'Página real',content:[
        {tag:'h3',attrs:{id:'Secao'},children:['Seção']},
        {tag:'p',children:[{tag:'a',attrs:{href:'https://telegram.org/',target:'_blank'},children:['site']},' e ',{tag:'a',attrs:{href:'#Secao'},children:['interno']}]},
        {tag:'figure',children:[{tag:'img',attrs:{src:'/file/6a5b15e7eb4d7329ca7af.jpg'}},{tag:'figcaption',children:['Legenda']}]},
        {tag:'figure',children:[{tag:'iframe',attrs:{src:'/embed/youtube?url=https%3A%2F%2Fyoutu.be%2Fx'}}]}
      ]}});
      return Response.json({ok:true,result:{url:'https://telegra.ph/'+path,path,title:'Página Telegraph',content:[{tag:'p',children:['Conteúdo Telegraph']}] }});
    }
    if(data.get('access_token')!=='persistent-test-token')return Response.json({ok:false,error:'invalid token'},{status:401});
    if(method==='getAccountInfo')return Response.json({ok:true,result:{short_name:'MDTXTRT',page_count:1}});
    if(['createPage','editPage'].includes(method)&&data.get('title')==='UPSTREAM_REJECT')return Response.json({ok:false,error:'test rejection'},{status:400});
    if(method==='createPage'&&data.get('title')==='UPSTREAM_TIMEOUT')throw new TypeError('simulated Telegraph transport failure');
    if(method==='createPage'&&data.get('title')==='STORAGE_AFTER_CREATE')mkdirSync(process.env.RAILWAY_VOLUME_MOUNT_PATH+'/telegraph-token-pages.json.tmp');
    const path=method==='createPage'?(data.get('title')==='LIVE_SHAPE'?'live-shape-page':'test-page-regression'):data.get('path');
    return Response.json({ok:true,result:{url:'https://telegra.ph/'+path,path}});
  }
  return real(url,options);
};
