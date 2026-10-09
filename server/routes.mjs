
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { DeliveryError, HttpError, WEBHOOK_BASE, asHttpError } from "./config.mjs";
import { cleanupIncomingMedia, readJson, readMedia, setCors } from "./http.mjs";
import { draftOwner, telegraphOwner, telegraphRevision, userFromInitData } from "./identity.mjs";
import { serveStatic } from "./static.mjs";
import { bindDraftFiles, clearDraftTelegraphPath, deletePersistentDraft, forgetTelegramPublication, handoffActionView, handoffFiles, handoffMediaPath, listPersistentDrafts, listTelegramPublications, listTelegraphPages, persistentDraftPaths, persistentDraftView, persistentMediaPath, publishHandoff, readHandoff, readPersistentDraft, saveHandoff, savePersistentDraft, writeHandoff, telegraphOwnerFromDraftOwner } from "./storage.mjs";
import { publishTelegramPersistent, sameSecret, webhookSecret } from "./telegram.mjs";
import { publishTelegraph, readPages, removeTelegraphPage, telegraphContentHTML, verifyTelegraphPage } from "./telegraph.mjs";
import { acceptUpdate, botLink, handleBotUpdate, selectedExportDocument } from "./bot.mjs";
import { prepareDownload, serveDownload } from "./download.mjs";

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if(url.pathname==="/telegram/open"&&req.method==="GET"){
      const handoff=String(url.searchParams.get("handoff")||"");
      if(!/^[a-f0-9]{32}$/.test(handoff)||!readHandoff(handoff)){
        res.writeHead(410,{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"});
        res.end("A transferência expirou ou é inválida.");
        return;
      }
      res.writeHead(302,{location:botLink+"?startapp=h_"+handoff,"cache-control":"no-store"});
      res.end();
      return;
    }


    const downloadPath=/^\/api\/export\/download\/([^/]*)$/.exec(url.pathname);
    if(downloadPath&&(req.method==="GET"||req.method==="HEAD")){
      serveDownload(req,res,downloadPath[1]);
      return;
    }

    if (url.pathname === "/api/export/download" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        let body;
        try{body=await readJson(req,4_000_000);}catch(error){throw asHttpError(error,400,"Dados do download inválidos");}
        let chatId;
        try{({chatId}=userFromInitData(String(body?.initData||"")));}catch(error){throw asHttpError(error,401,"Sessão Telegram inválida");}
        const prepared=prepareDownload(chatId,body);
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify(prepared));
      }catch(err){
        const code=err instanceof HttpError?err.status:500;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível preparar o download"}));
      }
      return;
    }

    if (url.pathname === "/api/export/source" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const body=await readJson(req,20000);
        const owner=draftOwner(body);
        if(owner.kind!=="telegram")throw new HttpError(400,"A exportação selecionada pelo bot exige identidade Telegram");
        const kind=String(body?.kind||"");
        const doc=String(body?.doc||"");
        const selected=await selectedExportDocument(owner,kind,doc);
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({kind,doc,name:selected.name,html:selected.html}));
      }catch(err){
        const code=err instanceof HttpError?err.status:err instanceof DeliveryError?502:400;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível preparar a exportação"}));
      }
      return;
    }

    if (url.pathname === "/api/library/list" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const body=await readJson(req,20000);
        const owner=draftOwner(body);
        const drafts=listPersistentDrafts(owner);
        const telegram=listTelegramPublications(owner,drafts);
        const telegraph=listTelegraphPages(owner,drafts);
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({drafts,telegram,telegraph}));
      }catch(err){
        const code=err instanceof HttpError?err.status:500;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível carregar a biblioteca"}));
      }
      return;
    }

    
    
    if (url.pathname === "/api/library/delete" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const body=await readJson(req,20000);
        const owner=draftOwner(body);
        const kind=String(body?.kind||"");
        const doc=String(body?.doc||"");
        if(!/^[a-f0-9-]{36}$/i.test(doc))throw new HttpError(400,"Documento inválido");
        let result;
        if(kind==="draft")result=deletePersistentDraft(owner,doc);
        else if(kind==="telegram")result=forgetTelegramPublication(owner,doc);
        else if(kind==="telegraph"){
          const removed=await removeTelegraphPage(telegraphOwnerFromDraftOwner(owner),doc,"list");
          result={path:removed.path,mode:removed.mode,draftUnlinked:clearDraftTelegraphPath(owner,doc,removed.path)};
        }
        else throw new HttpError(400,"Tipo de item da biblioteca inválido");
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({ok:true,kind,doc,...result}));
      }catch(err){
        const code=err instanceof HttpError?err.status:500;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível excluir o item"}));
      }
      return;
    }

    if (url.pathname === "/api/drafts/save" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      let media=null;
      try{
        media=await readMedia(req);
        let draft;
        try{draft=JSON.parse(media.fields.draft||"");}catch{throw new HttpError(400,"Rascunho inválido");}
        const owner=draftOwner(media.fields);
        const files=bindDraftFiles(media.files,draft);
        const record=savePersistentDraft(owner,draft,files);
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify(persistentDraftView(record)));
      }catch(err){
        const code=err instanceof HttpError?err.status:507;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível persistir o rascunho"}));
      }finally{cleanupIncomingMedia(media);}
      return;
    }

    if (url.pathname === "/api/drafts/load" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const body=await readJson(req,20000);
        const owner=draftOwner(body);
        const doc=body?.doc===undefined?"":String(body.doc||"");
        if(doc&&!/^[a-f0-9-]{36}$/i.test(doc))throw new HttpError(400,"Documento inválido");
        const record=readPersistentDraft(owner,doc);
        if(!record){
          res.writeHead(404,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
          res.end(JSON.stringify({error:"Rascunho persistido não encontrado"}));
          return;
        }
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify(persistentDraftView(record)));
      }catch(err){
        const code=err instanceof HttpError?err.status:500;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível recuperar o rascunho"}));
      }
      return;
    }

    if (url.pathname === "/api/drafts/file" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const body=await readJson(req,20000);
        const owner=draftOwner(body);
        const doc=String(body?.doc||""),id=String(body?.id||"");
        if(!/^[a-f0-9-]{36}$/i.test(doc)||!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw new HttpError(400,"Anexo persistido inválido");
        const record=readPersistentDraft(owner,doc);
        const meta=record?.media?.find(item=>item.id===id);
        if(!meta)throw new HttpError(404,"Anexo persistido não encontrado");
        const path=persistentMediaPath(persistentDraftPaths(owner,doc),id);
        res.writeHead(200,{"content-type":meta.mime,"content-length":meta.size,"cache-control":"no-store","x-mdtxtrt-file-name":encodeURIComponent(meta.name),"x-mdtxtrt-file-kind":meta.kind});
        createReadStream(path).pipe(res);
      }catch(err){
        const code=err instanceof HttpError?err.status:500;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível recuperar o anexo"}));
      }
      return;
    }

    if (url.pathname === "/api/handoff" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      let media=null;
      try {
        media=await readMedia(req);
        let draft,action=null;
        try{draft=JSON.parse(media.fields.draft||"");}catch{throw new Error("Rascunho inválido");}
        if(media.fields.action){
          try{action=JSON.parse(media.fields.action);}catch{throw new Error("Ação da transferência inválida");}
        }
        const files=bindDraftFiles(media.files,draft);
        const token=saveHandoff(draft,files,action);
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({token,open:WEBHOOK_BASE+"/telegram/open?handoff="+token}));
      }catch(err){
        res.writeHead(400,{"content-type":"application/json; charset=utf-8"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível transferir o rascunho"}));
      }finally{cleanupIncomingMedia(media);}
      return;
    }

    if (url.pathname === "/api/handoff/claim" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const body = await readJson(req, 20000);
        const token = String(body?.token || "");
        const state = readHandoff(token);
        if (!state) throw new Error("Transferência expirada ou inválida");
        const { chatId } = userFromInitData(String(body?.initData || ""));
        if (state.claimedBy && state.claimedBy !== chatId) throw new Error("Transferência não pertence a esta sessão");
        state.claimedBy = chatId;
        writeHandoff(token,state);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({draft:state.draft,files:state.files,purpose:state.purpose,action:handoffActionView(state.action,state.draft)}));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message || "Não foi possível recuperar o rascunho" }));
      }
      return;
    }

    if (url.pathname === "/api/handoff/status" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const body=await readJson(req,20000);
        const token=String(body?.token||"");
        const state=readHandoff(token);
        if(!state)throw new HttpError(410,"Transferência expirada ou inválida");
        const {chatId}=userFromInitData(String(body?.initData||""));
        if(!state.claimedBy||state.claimedBy!==chatId)throw new HttpError(403,"Transferência não pertence a esta sessão");
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ action: handoffActionView(state.action,state.draft) }));
      } catch (err) {
        const code=err instanceof HttpError?err.status:400;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err instanceof Error?err.message:"Não foi possível consultar a transferência" }));
      }
      return;
    }

    if (url.pathname === "/api/handoff/publish" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const body=await readJson(req,20000);
        const token=String(body?.token||"");
        const initData=String(body?.initData||"");
        const state=readHandoff(token);
        if(!state)throw new HttpError(410,"Transferência expirada ou inválida");
        const {chatId}=userFromInitData(initData);
        if(!state.claimedBy||state.claimedBy!==chatId)throw new HttpError(403,"Transferência não pertence a esta sessão");
        const outcome=await publishHandoff(token,state,initData);
        res.writeHead(outcome.code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ action: outcome.action, reused: outcome.reused, ...(outcome.action?.status==="succeeded"?{result:outcome.action.result}:{}) }));
      } catch (err) {
        const code=err instanceof HttpError?err.status:400;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err instanceof Error?err.message:"Não foi possível publicar a transferência" }));
      }
      return;
    }

    if (url.pathname === "/api/handoff/file" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const body = await readJson(req, 20000);
        const token=String(body?.token||""),id=String(body?.id||"");
        if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw new Error("Anexo da transferência inválido");
        const state=readHandoff(token);
        const meta=state?.files?.find(item=>item.id===id);
        if(!meta)throw new Error("Anexo da transferência indisponível");
        const {chatId}=userFromInitData(String(body?.initData||""));
        if(!state.claimedBy||state.claimedBy!==chatId)throw new Error("Transferência não pertence a esta sessão");
        const path=handoffMediaPath(handoffFiles(token),id);
        if(!existsSync(path))throw new Error("Anexo da transferência indisponível");
        res.writeHead(200,{"content-type":meta.mime,"content-length":meta.size,"cache-control":"no-store"});
        createReadStream(path).pipe(res);
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message || "Não foi possível recuperar o anexo" }));
      }
      return;
    }

    if (url.pathname === "/api/telegraph/load" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const body=await readJson(req,20000);
        const doc=String(body?.doc||"");
        if(!/^[a-f0-9-]{36}$/i.test(doc))throw new HttpError(400,"Documento inválido");
        const ownerKey=telegraphOwner(body);
        const mapped=readPages()[ownerKey+":"+doc]||"";
        if(mapped&&typeof mapped!=="string")throw new HttpError(409,"Resultado anterior incerto no Telegraph; confira a página antes de editar");
        if(!mapped){
          res.writeHead(404,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
          res.end(JSON.stringify({error:"Página não encontrada"}));
          return;
        }
        const page=await verifyTelegraphPage(mapped);
        if(!Array.isArray(page.content))throw new Error("O Telegraph não retornou o conteúdo da página");
        const html=telegraphContentHTML(page.content);
        let revision=0,updatedAt=0;
        try{
          const owner=draftOwner(body);
          const record=readPersistentDraft(owner,doc);
          if(record){revision=record.draft.revision;updatedAt=record.updatedAt;}
        }catch(error){if(error instanceof HttpError)throw error;console.error("Telegraph draft metadata",error);}
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({doc,path:page.path,url:page.url,title:String(page.title||"Página Telegraph"),html,revision,updatedAt}));
      }catch(err){
        const code=err instanceof HttpError?err.status:502;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível carregar a página"}));
      }
      return;
    }

    if (url.pathname === "/api/telegraph/recover" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        let body;
        try{body=await readJson(req,20000);}catch(error){throw asHttpError(error,400,"Dados de recuperação inválidos");}
        const doc=String(body?.doc||"");
        if (!/^[a-f0-9-]{36}$/i.test(doc)) throw new HttpError(400,"Documento inválido");
        const revision=telegraphRevision(body?.revision);
        const owner=telegraphOwner(body);
        const path = readPages()[owner + ":" + doc] || "";
        if (path && typeof path !== "string") throw new HttpError(409,"Resultado anterior incerto no Telegraph; confira a página antes de criar outra");
        if (!path) {
          res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ error: "Página não encontrada" }));
          return;
        }
        const page = await verifyTelegraphPage(path);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ path: page.path, url: page.url, doc, revision }));
      } catch (err) {
        const code = err instanceof HttpError ? err.status : 502;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Não foi possível recuperar a página" }));
      }
      return;
    }

    if (req.method === "OPTIONS") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }
    if(url.pathname==="/telegram/webhook"&&req.method==="POST"){
      if (!sameSecret(req.headers["x-telegram-bot-api-secret-token"], webhookSecret())) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      let update;
      try { update = await readJson(req); }
      catch (err) {
        console.error("Telegram webhook", err);
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Atualização inválida" }));
        return;
      }
      
      
      
      if (acceptUpdate(update)) {
        try { await handleBotUpdate(update); }
        catch (err) { console.error("Telegram webhook", err); }
      }
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    if (url.pathname === "/api/telegram/send" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      let media=null;
      try{
        media=await readMedia(req);
        const body=media.fields;
        if(typeof body.initData!=="string"||typeof body.html!=="string"||typeof body.draft!=="string"||!body.draft.trim())throw new HttpError(400,"Os dados do envio estão incompletos");
        let draft;
        try{draft=JSON.parse(body.draft);}catch{throw new HttpError(400,"Rascunho de publicação inválido");}
        const files=bindDraftFiles(media.files,draft);
        const result=await publishTelegramPersistent(body.initData,draft,body.html,files);
        res.writeHead(200,{"content-type":"application/json; charset=utf-8"});
        res.end(JSON.stringify(result));
      }catch(err){
        const msg=err instanceof Error?err.message:"Não foi possível publicar no Telegram";
        const limited=err instanceof DeliveryError&&err.retryAfter>0;
        const code=err instanceof HttpError?err.status:limited?429:err instanceof DeliveryError?(err.outcome==="uncertain"?409:502):400;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8",...(limited?{"retry-after":String(err.retryAfter)}:{})});
        res.end(JSON.stringify({error:msg,...(err instanceof DeliveryError?{outcome:err.outcome}:{}),...(limited?{retryAfter:err.retryAfter}:{})}));
      }finally{cleanupIncomingMedia(media);}
      return;
    }

    if (url.pathname === "/api/telegram/session" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const body=await readJson(req,10000);
        userFromInitData(String(body?.initData||""));
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message || "Sessão Telegram inválida" }));
      }
      return;
    }
    if (url.pathname === "/api/telegraph/publish" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        let body;
        try{body=await readJson(req,150_000);}catch(error){throw asHttpError(error,400,"Dados da página inválidos");}
        if (!body || typeof body !== "object" || typeof body.title !== "string" || !Array.isArray(body.content) || (body.path !== undefined && typeof body.path !== "string")) throw new HttpError(400,"Os dados da página estão incompletos");
        const doc=String(body.doc||"");
        if(!/^[a-f0-9-]{36}$/i.test(doc))throw new HttpError(400,"Documento inválido");
        const revision=telegraphRevision(body.revision);
        const owner=telegraphOwner(body);
        const page = await publishTelegraph(body.title, body.content, body.path || "", owner, doc);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ url: page.url, path: page.path, doc, revision }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Não foi possível publicar no Telegraph";
        const code = err instanceof HttpError ? err.status : err instanceof DeliveryError ? 409 : 502;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: msg, ...(err instanceof DeliveryError ? {outcome:err.outcome} : {}) }));
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Método não permitido" }));
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Não foi possível concluir a solicitação" }));
    } else if (!res.destroyed) res.destroy(error);
  }
});
