import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const releaseManifest=JSON.parse(readFileSync(new URL('../RELEASE_MANIFEST.json',import.meta.url),'utf8'));
const baselineSha=process.env.BASELINE_SHA||releaseManifest.visualComparisonSnapshot;
if(!/^[a-f0-9]{40}$/.test(baselineSha))throw new Error('BASELINE_SHA (comparison snapshot) inválido');

const repo=process.cwd();
const tempRoot=mkdtempSync(join(tmpdir(),'mdtxtrt-visual-'));
const baselineRoot=join(tempRoot,'baseline');
const outDir=resolve(repo,'.release-visual');
mkdirSync(outDir,{recursive:true});

const mime=new Map([
  ['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.svg','image/svg+xml'],
  ['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webmanifest','application/manifest+json; charset=utf-8']
]);

function deterministicHTML(text,theme){
  const boot=`<script id="release-visual-boot">try{localStorage.clear();localStorage.setItem('mdtxtrt-theme',${JSON.stringify(theme)})}catch{}window.fetch=async()=>({ok:false,status:404,json:async()=>({})});window.Telegram=undefined;</script><style id="release-visual-determinism">*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}</style>`;
  return text
    .replace('<head>','<head>'+boot)
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
        body=Buffer.from(deterministicHTML(body.toString('utf8'),theme));
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

function capture(chrome,url,out,profileName){
  const args=[
    '--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars',
    '--window-size=390,844','--force-device-scale-factor=1',
    '--run-all-compositor-stages-before-draw','--virtual-time-budget=3000',
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
    const candidatePng=join(outDir,`candidate-${theme}-shell-390x844.png`);
    const baselinePng=join(outDir,`baseline-${theme}-shell-390x844.png`);
    await capture(chrome,`http://127.0.0.1:4173/?theme=${theme}`,candidatePng,`chrome-candidate-${theme}`);
    await capture(chrome,`http://127.0.0.1:4174/?theme=${theme}`,baselinePng,`chrome-baseline-${theme}`);
    const candidate=readFileSync(candidatePng),baseline=readFileSync(baselinePng);
    summaries.push({
      theme,
      baselineSha,
      candidateSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
      candidateScreenshot:sha(candidatePng),
      baselineScreenshot:sha(baselinePng),
      identical:candidate.equals(baseline)
    });
  }
  writeFileSync(join(outDir,'summary.json'),JSON.stringify({viewport:'390x844@1x',comparisons:summaries},null,2)+'\n');
  console.log(JSON.stringify(summaries,null,2));
  const divergent=summaries.filter(item=>!item.identical);
  const preservationRequired=process.env.BASELINE_PRESERVATION_REQUIRED==='1';
  if(divergent.length){
    const themes=divergent.map(item=>item.theme).join(', ');
    if(preservationRequired){
      throw new Error('Preservação visual foi explicitamente exigida e o shell divergiu do snapshot de comparação em: '+themes);
    }
    console.warn('VISUAL EVOLUTION REVIEW: o candidato divergiu do snapshot de comparação em: '+themes+'. Isto não é falha automática. Revise se a divergência é evolução deliberada ou regressão; se aceita, avance RELEASE_MANIFEST.json.visualComparisonSnapshot.');
  } else {
    console.log('O candidato permanece visualmente idêntico à referência atual.');
  }
}finally{
  if(candidateServer)await close(candidateServer).catch(()=>{});
  if(baselineServer)await close(baselineServer).catch(()=>{});
  try{execFileSync('git',['worktree','remove','--force',baselineRoot],{stdio:'ignore'});}catch{}
  rmSync(tempRoot,{recursive:true,force:true});
}
