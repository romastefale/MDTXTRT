const real = globalThis.fetch;
import {appendFileSync} from 'node:fs';
globalThis.fetch = async (url,options) => {
  const host = new URL(url).host;
  if(host === 'api.telegram.org') {
    if(new URL(url).pathname.endsWith('/sendRichMessage') && process.env.TEST_CALLS)appendFileSync(process.env.TEST_CALLS,options.body+'\n');
    return Response.json({ok:true,result:{message_id:42}});
  }
  if(host === 'api.telegra.ph') {
    const method = new URL(url).pathname.slice(1);
    const data = new URLSearchParams(options.body);
    if(method === 'createAccount') return Response.json({ok:true,result:{access_token:'persistent-test-token'}});
    if(data.get('access_token') !== 'persistent-test-token') return Response.json({ok:false,error:'invalid token'},{status:401});
    const path = method === 'createPage' ? 'test-page-09-26' : data.get('path');
    return Response.json({ok:true,result:{url:'https://telegra.ph/'+path,path}});
  }
  return real(url,options);
};
