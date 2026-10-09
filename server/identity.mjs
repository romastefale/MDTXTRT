
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { BOT_TOKEN, HttpError, asHttpError } from "./config.mjs";

export function userFromInitData(initData) {
  if (!initData.trim()) throw new Error("Abra pelo bot no Telegram");
  const params = new URLSearchParams(initData);
  if (initData.length > 8192 || [...params.keys()].length !== new Set(params.keys()).size) throw new Error("Sessão Telegram inválida");
  const hash = params.get("hash") || "";
  params.delete("hash");
  
  
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const check = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const actual = Buffer.from(check, "hex");
  const expected = /^[a-f0-9]{64}$/i.test(hash) ? Buffer.from(hash, "hex") : Buffer.alloc(0);
  if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) throw new Error("Sessão Telegram inválida");
  const authDate = Number(params.get("auth_date") || "0");
  const now = Date.now() / 1000;
  if (!authDate || authDate > now + 60 || now - authDate > 86400) {
    throw new Error("Sessão Telegram expirada");
  }
  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Usuário Telegram ausente");
  let user;
  try { user = JSON.parse(userRaw); } catch { throw new Error("Dados da sessão inválidos"); }
  if (!user?.id) throw new Error("Usuário Telegram ausente");
  return { chatId: String(user.id), userId: String(user.id) };
}

export function telegraphOwner(body){
  const initData=typeof body?.initData==="string"?body.initData.trim():"";
  const browserKey=typeof body?.browserKey==="string"?body.browserKey.trim():"";
  if(initData&&browserKey)throw new HttpError(400,"Identidade de publicação ambígua");
  if(initData){
    try{return userFromInitData(initData).chatId;}
    catch(error){throw asHttpError(error,400,"Sessão Telegram inválida");}
  }
  if(!/^[a-f0-9]{64}$/.test(browserKey))throw new HttpError(400,"Identidade do navegador inválida");
  return "browser:"+createHash("sha256").update(browserKey).digest("hex");
}
export function draftOwner(body){
  const initData=typeof body?.initData==="string"?body.initData.trim():"";
  const browserKey=typeof body?.browserKey==="string"?body.browserKey.trim():"";
  if(initData&&browserKey)throw new HttpError(400,"Identidade de rascunho ambígua");
  if(initData){
    try{
      const {chatId,userId}=userFromInitData(initData);
      return {key:"telegram:"+userId,kind:"telegram",telegramUserId:userId,chatId};
    }catch(error){throw asHttpError(error,400,"Sessão Telegram inválida");}
  }
  if(!/^[a-f0-9]{64}$/.test(browserKey))throw new HttpError(400,"Identidade do navegador inválida");
  const fingerprint=createHash("sha256").update(browserKey).digest("hex");
  return {key:"browser:"+fingerprint,kind:"browser",telegramUserId:"",chatId:""};
}
export function ownerFingerprint(owner){
  return createHash("sha256").update(owner.key).digest("hex");
}
export function telegraphRevision(value){
  if(value===undefined)return 0;
  if(!Number.isSafeInteger(value)||value<0)throw new HttpError(400,"Revisão do documento inválida");
  return value;
}

function telegramPrivateOwner(userId,chatId){
  const uid=String(userId??"").trim();
  const cid=String(chatId??"").trim();
  if(!/^\d+$/.test(uid)||!/^\d+$/.test(cid))throw new Error("Identidade privada do Telegram inválida");
  return {key:"telegram:"+uid,kind:"telegram",telegramUserId:uid,chatId:cid};
}

export function ownerFromBotMessage(message){
  const chatId=message?.chat?.id;
  return telegramPrivateOwner(message?.from?.id??chatId,chatId);
}
