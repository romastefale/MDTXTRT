
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, unlinkSync } from "node:fs";
import Busboy from "busboy";
import { ALLOW_ORIGINS, TMP_DIR } from "./config.mjs";

function corsOrigin(req) {
  const origin = req.headers.origin || "";
  return ALLOW_ORIGINS.has(origin) ? origin : "";
}

export function setCors(req, res) {
  const allow = corsOrigin(req);
  if (!allow) return false;
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  return true;
}

export async function readJson(req, maxBytes = 80_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("A solicitação é grande demais");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) throw new Error("A solicitação está vazia");
  try { return JSON.parse(raw); } catch { throw new Error("Não foi possível ler os dados recebidos"); }
}

export async function readMedia(req) {
  if (!/^multipart\/form-data;\s*boundary=/i.test(req.headers["content-type"] || "")) throw new Error("Formato de mídia inválido");
  return new Promise((resolve, reject) => {
    const fields = {}, files = [], pending = [];
    let failed=false;
    const fail=error=>{
      if(failed)return;
      failed=true;
      for(const file of files)try{if(file.path&&existsSync(file.path))unlinkSync(file.path);}catch{}
      reject(error);
    };
    const bus = Busboy({headers:req.headers,limits:{files:50,fileSize:50_000_000,fields:8,fieldSize:400000}});
    bus.on("field",(key,value)=>{fields[key]=value;});
    bus.on("file",(key,stream,info)=>{
      if (!/^upload_[A-Za-z0-9_-]{1,64}$/.test(key)) {stream.resume();fail(new Error("Campo de mídia inválido"));return;}
      const path=TMP_DIR+"/"+randomUUID()+".upload";
      const file={field:key,id:key.slice(7),path,mime:info.mimeType,name:info.filename.slice(0,120),size:0};
      files.push(file);
      const task=new Promise((done,stop)=>{
        const out=createWriteStream(path,{mode:0o600});
        stream.on("data",chunk=>{file.size+=chunk.length;});
        stream.on("limit",()=>{out.destroy();stop(new Error("Arquivo acima do limite de 50 MB do Telegram"));});
        stream.on("error",error=>{out.destroy();stop(error);});
        out.on("error",stop);
        out.on("finish",done);
        stream.pipe(out);
      });
      pending.push(task);
    });
    bus.on("filesLimit",()=>fail(new Error("O Telegram aceita no máximo 50 mídias por mensagem")));
    bus.on("error",fail);
    bus.on("close",async()=>{
      if(failed)return;
      try{
        await Promise.all(pending);
        if(files.some(file=>file.size<1))throw new Error("Arquivo vazio");
        resolve({fields,files});
      }catch(error){
        for(const file of files)try{if(file.path&&existsSync(file.path))unlinkSync(file.path);}catch{}
        reject(error);
      }
    });
    req.pipe(bus);
  });
}
export function cleanupIncomingMedia(media){
  for(const file of media?.files||[])try{if(file.path&&existsSync(file.path))unlinkSync(file.path);}catch(error){console.error("Temporary upload cleanup",error);}
}
