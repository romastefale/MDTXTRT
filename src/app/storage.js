







const PROBE_KEY='mdtxtrt-storage-probe';
let memory=null;
function detect(){
  try{
    const store=window.localStorage;
    if(!store)throw new Error('sem localStorage');
    store.getItem(PROBE_KEY);
    return false;
  }catch{
    return true;
  }
}
if(detect())memory=new Map();
export function storageBlocked(){return memory!==null;}
export function storageGet(key){
  if(memory)return memory.has(key)?memory.get(key):null;
  return window.localStorage.getItem(key);
}
export function storageSet(key,value){
  if(memory){memory.set(key,String(value));return;}
  window.localStorage.setItem(key,value);
}
export function storageRemove(key){
  if(memory){memory.delete(key);return;}
  window.localStorage.removeItem(key);
}




export const STORAGE_BLOCKED_NOTICE='Este navegador está bloqueando o armazenamento de dados dos sites. Dá para escrever, publicar e exportar normalmente, mas o texto não fica salvo ao fechar ou recarregar a página. No iPhone, desative Bloquear Todos os Cookies em Ajustes › Apps › Safari › Avançado (no iOS 17: Ajustes › Safari › Avançado).';
