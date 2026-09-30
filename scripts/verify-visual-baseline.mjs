import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const baselineSha=process.env.BASELINE_SHA||'db6ae2240cbe2792bd7edb1a9c26399f068ea807';
if(!/^[a-f0-9]{40}$/.test(baselineSha))throw new Error('BASELINE_SHA inválido');

const repo=process.cwd();
const tempRoot=mkdtempSync(join(tmpdir(),'mdtxtrt-visual-'));
const baselineRoot=join(tempRoot,'baseline');
const outDir=resolve(repo,'.release-visual');
mkdirSync(outDir,{recursive:true});

const states=[
  {id:'shell',width:390,height:844},
  {id:'app-menu',width:390,height:844},
  {id:'library-menu',width:390,height:844},
  {id:'plus-menu',width:390,height:844},
  {id:'plus-format',width:390,height:844},
  {id:'app-menu-keyboard',width:390,height:430,typing:true},
  {id:'library-menu-keyboard',width:390,height:430,typing:true}
];

const mime=new Map([
  ['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.svg','image/svg+xml'],
  ['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webmanifest','application/manifest+json; charset=utf-8']
]);

function deterministicHTML(text,theme,state){
  const boot=`<script id="release-visual-boot">try{localStorage.clear();localStorage.setItem('mdtxtrt-theme',${JSON.stringify(theme)})}catch{}window.fetch=async input=>{const url=String(input||'');if(url.includes('/api/library/list'))return {ok:true,status:200,json:async()=>({drafts:[],telegram:[],telegraph:[]})};return {ok:false,status:404,json:async()=>({})}};window.Telegram=undefined;window.__RELEASE_VISUAL_STATE__=${JSON.stringify(state)};</script><style id="release-visual-determinism">*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}</style>`;
  const driver=`<script id="release-visual-driver">window.addEventListener('load',()=>{setTimeout(async()=>{const state=window.__RELEASE_VISUAL_STATE__;const click=id=>document.getElementById(id)?.click();const editor=document.getElementById('editor');if(state.endsWith('-keyboard'))editor?.focus({preventScroll:true});if(state==='app-menu'||state==='app-menu-keyboard')click('exportBtn');if(state==='library-menu'||state==='library-menu-keyboard'){click('exportBtn');await new Promise(r=>setTimeout(r,80));click('libraryBtn')}if(state==='plus-menu')click('plusBtn');if(state==='plus-format'){click('plusBtn');await new Promise(r=>setTimeout(r,60));document.querySelector('#plusMenu [data-plus-category="format"]')?.click()}await new Promise(r=>setTimeout(r,220));document.documentElement.setAttribute('data-release-visual-ready',state)},220)})</script>`;
  return text
    .replace('<head>','<head>'+boot)
    .replace('</body>',driver+'</body>')
    .replace(/<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js\?[^"]+"><\/script>/,'<!-- Telegram runtime blocked by release visual harness -->');
}

function staticServer(root){
  const rootAbs=resolve(root);
  return createServer((req,res)=>{
    try{
      const url=new URL(req.url||'/','http://127.0.0.1');
      let pathname=decodeURIComponent(url.pathname);
      if(pathname==='/')pathname='/index.html';
      const file=resolve(rootAbs,'.'+pathname);
      if(file!==rootAbs&&!file.startsWith(rootAbs+sep)){res.writeHead(403).end('forbidden');return;}
      let body=readFileSync(file);
      if(extname(file)==='.html'){
        const theme=url.searchParams.get('theme')==='dark'?'dark':'light';
        const state=url.searchParams.get('state')||'shell';
        body=Buffer.from(deterministicHTML(body.toString('utf8'),theme,state));
      }
      res.writeHead(200,{'content-type':mime.get(extname(file))||'application/octet-stream','cache-control':'no-store'});
      res.end(body);
    }catch{
      res.writeHead(404,{'content-type':'text/plain'});res.end('not found');
    }
  });
}

const listen=(server,port)=>new Promise((resolveListen,reject)=>{
  server.once('error',reject);
  server.listen(port,'127.0.0.1',resolveListen);
});
const close=server=>new Promise(resolveClose=>server.close(()=>resolveClose()));

function chromeBinary(){
  const choices=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);
  const found=choices.find(existsSync);
  if(!found)throw new Error('Chrome/Chromium não encontrado no runner');
  return found;
}

function capture(chrome,url,out,profileName,width,height){
  const args=[
    '--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars',
    `--window-size=${width},${height}`,'--force-device-scale-factor=1',
    '--run-all-compositor-stages-before-draw','--virtual-time-budget=4500',
    '--disable-background-networking','--disable-component-update','--disable-sync',
    '--no-first-run','--no-default-browser-check',
    `--user-data-dir=${join(tempRoot,profileName)}`,
    `--screenshot=${out}`,url
  ];
  return new Promise((resolveCapture,reject)=>{
    const child=spawn(chrome,args,{stdio:['ignore','pipe','pipe']});
    let stderr='';
    child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('error',reject);
    child.on('exit',code=>{
      if(code===0&&existsSync(out))resolveCapture();
      else reject(new Error(`Chrome falhou (${code}): ${stderr.slice(-3000)}`));
    });
  });
}

function sha(path){
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

let candidateServer,baselineServer;
try{
  execFileSync('git',['worktree','add','--detach',baselineRoot,baselineSha],{stdio:'inherit'});
  candidateServer=staticServer(repo);
  baselineServer=staticServer(baselineRoot);
  await listen(candidateServer,4173);
  await listen(baselineServer,4174);
  const chrome=chromeBinary();
  const summaries=[];
  for(const theme of ['light','dark']){
    for(const state of states){
      const suffix=`${theme}-${state.id}-${state.width}x${state.height}`;
      const candidatePng=join(outDir,`candidate-${suffix}.png`);
      const baselinePng=join(outDir,`baseline-${suffix}.png`);
      const query=`?theme=${theme}&state=${state.id}`;
      await capture(chrome,`http://127.0.0.1:4173/${query}`,candidatePng,`chrome-candidate-${theme}-${state.id}`,state.width,state.height);
      await capture(chrome,`http://127.0.0.1:4174/${query}`,baselinePng,`chrome-baseline-${theme}-${state.id}`,state.width,state.height);
      const candidate=readFileSync(candidatePng),baseline=readFileSync(baselinePng);
      summaries.push({
        theme,
        state:state.id,
        viewport:`${state.width}x${state.height}@1x`,
        typing:Boolean(state.typing),
        baselineSha,
        candidateSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
        candidateScreenshot:sha(candidatePng),
        baselineScreenshot:sha(baselinePng),
        identical:candidate.equals(baseline)
      });
    }
  }
  writeFileSync(join(outDir,'summary.json'),JSON.stringify({comparisons:summaries},null,2)+'\n');
  console.log(JSON.stringify(summaries,null,2));
  const failed=summaries.filter(item=>!item.identical);
  if(failed.length)throw new Error('A renderização estável divergiu da baseline visual em: '+failed.map(item=>item.theme+'/'+item.state).join(', '));
}finally{
  if(candidateServer)await close(candidateServer).catch(()=>{});
  if(baselineServer)await close(baselineServer).catch(()=>{});
  try{execFileSync('git',['worktree','remove','--force',baselineRoot],{stdio:'ignore'});}catch{}
  rmSync(tempRoot,{recursive:true,force:true});
}
