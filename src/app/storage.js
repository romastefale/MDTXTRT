// Armazenamento local com reserva em memória.
// No Safari com "Bloquear Todos os Cookies" (e em navegadores que negam dados de
// site), ler o localStorage já lança SecurityError; o IndexedDB fica bloqueado do
// mesmo jeito. Nesse caso não existe cópia local que possa ser substituída, então
// o app guarda o rascunho e a identidade do navegador em memória durante a sessão
// e avisa uma vez que nada fica salvo ao fechar ou recarregar.
// Se o localStorage lê mas não grava (cota cheia), nada muda aqui: os erros de
// gravação continuam chegando a quem grava, como antes.
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
// Caminho do ajuste conforme o suporte da Apple ("Enable cookies on iPhone"):
// Ajustes › Apps › Safari › Avançado › Bloquear Todos os Cookies no iOS 18 e no
// iOS 26 (a seção Apps dos Ajustes chegou no iOS 18); no iOS 17 o mesmo item fica
// em Ajustes › Safari › Avançado.
export const STORAGE_BLOCKED_NOTICE='Este navegador está bloqueando o armazenamento de dados dos sites. Dá para escrever, publicar e exportar normalmente, mas o texto não fica salvo ao fechar ou recarregar a página. No iPhone, desative Bloquear Todos os Cookies em Ajustes › Apps › Safari › Avançado (no iOS 17: Ajustes › Safari › Avançado).';
