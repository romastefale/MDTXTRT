"""RichMessageButton 10.3: editor completo; success é default apenas na criação."""
from __future__ import annotations

from aiohttp import web
from aiogram.types import CallbackQuery

_MARKER = "mdtxtrt-rich-buttons-green"

_UI = r'''<style id="mdtxtrt-rich-buttons-green-style">
tg-button[style="success"]{background:#31b545!important;color:#fff!important;border-color:#31b545!important}
</style>
<script id="mdtxtrt-rich-buttons-green">
(function(){
  var body=document.getElementById('generatorBody');
  var editor=document.getElementById('editor');
  if(!body||!editor)return;
  var defs=[
    {label:'Botão URL',type:'url',fields:[['url','URL HTTP, HTTPS ou tg://','https://...']]},
    {label:'Callback',type:'callback_data',fields:[['data','Callback data (1–64 bytes)','acao']]},
    {label:'Mini App',type:'web_app',fields:[['url','URL HTTPS do Mini App','https://...']]},
    {label:'Login',type:'login_url',fields:[['url','URL HTTPS (domínio configurado no BotFather)','https://...'],['forward','Texto ao encaminhar (opcional)','']]},
    {label:'Inline · escolher chat',type:'switch_inline_query',fields:[['query','Consulta inline (pode ficar vazia)','']]},
    {label:'Inline · chat atual',type:'switch_inline_query_current_chat',fields:[['query','Consulta inline (pode ficar vazia)','']]},
    {label:'Inline · escolher tipo',type:'switch_inline_query_chosen_chat',fields:[['query','Consulta inline (pode ficar vazia)','']]},
    {label:'Copiar texto',type:'copy_text',fields:[['text','Texto que será copiado','Conteúdo']]},
    {label:'Desabilitado',type:'disabled',fields:[]}
  ];
  function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  function validHttpOrTg(v){return /^(https?:\/\/|tg:\/\/)/i.test(String(v||'').trim())}
  function validHttps(v){return /^https:\/\//i.test(String(v||'').trim())}
  function bytes(v){return new TextEncoder().encode(String(v||'')).length}
  function toast(message){
    var el=document.getElementById('toast');
    if(!el)return;
    el.textContent=message;el.classList.add('on');
    window.setTimeout(function(){el.classList.remove('on')},1800);
  }
  function insert(markup,inlineMode){
    var start=editor.selectionStart,end=editor.selectionEnd,value=editor.value;
    var before='',after='';
    if(inlineMode){
      before=start>0&&!/\s/.test(value.charAt(start-1))?' ':'';
      after=end<value.length&&!/\s/.test(value.charAt(end))?' ':'';
    }else{
      before=start>0&&value.charAt(start-1)!=='\n'?'\n\n':'';
      after=end<value.length&&value.charAt(end)!=='\n'?'\n\n':'\n';
    }
    editor.value=value.slice(0,start)+before+markup+after+value.slice(end);
    var pos=start+before.length+markup.length;
    editor.focus();editor.setSelectionRange(pos,pos);
    editor.dispatchEvent(new Event('input',{bubbles:true}));
    var backdrop=document.getElementById('insertBackdrop');
    if(backdrop){backdrop.classList.remove('on');backdrop.setAttribute('aria-hidden','true')}
  }
  function inputField(form,key,labelText,placeholder){
    var label=document.createElement('label');label.textContent=labelText;
    var input=document.createElement('input');input.name=key;input.placeholder=placeholder||'';input.autocomplete='off';
    label.appendChild(input);form.appendChild(label);return input;
  }
  function checkbox(form,key,text,checked){
    var label=document.createElement('label');
    var input=document.createElement('input');input.type='checkbox';input.name=key;input.checked=!!checked;
    input.style.width='auto';input.style.height='auto';input.style.marginRight='8px';
    label.appendChild(input);label.appendChild(document.createTextNode(text));form.appendChild(label);return input;
  }
  function showForm(def){
    body.innerHTML='';
    var back=document.createElement('button');back.type='button';back.textContent='← todos os blocos';
    back.onclick=function(){document.getElementById('btnInsert').click()};body.appendChild(back);
    var h=document.createElement('h2');h.textContent=def.label;body.appendChild(h);
    var form=document.createElement('form');form.className='settings-grid';
    var selected=editor.selectionEnd>editor.selectionStart?editor.value.slice(editor.selectionStart,editor.selectionEnd):'';
    var label=inputField(form,'label','Texto do botão',selected||def.label);
    def.fields.forEach(function(f){inputField(form,f[0],f[1],f[2])});
    var write=null;
    if(def.type==='login_url')write=checkbox(form,'write','Solicitar permissão para enviar mensagens',false);
    var chosen={};
    if(def.type==='switch_inline_query_chosen_chat'){
      chosen.user=checkbox(form,'allow_user','Permitir chats com usuários',true);
      chosen.bot=checkbox(form,'allow_bot','Permitir chats com bots',true);
      chosen.group=checkbox(form,'allow_group','Permitir grupos',true);
      chosen.channel=checkbox(form,'allow_channel','Permitir canais',true);
    }
    var inline=checkbox(form,'inline','Inserir como botão inline no texto',false);
    var submit=document.createElement('button');submit.type='submit';submit.className='solid';submit.textContent='Inserir botão verde';submit.style.minHeight='46px';form.appendChild(submit);
    form.onsubmit=function(event){
      event.preventDefault();
      var text=label.value.trim()||def.label;
      var attrs=['type="'+def.type+'"','style="success"'];
      function val(name){var el=form.elements[name];return el?String(el.value||'').trim():''}
      if(def.type==='url'){
        if(!validHttpOrTg(val('url'))){toast('Use URL HTTP, HTTPS ou tg://');return}
        attrs.push('url="'+esc(val('url'))+'"');
      }else if(def.type==='callback_data'){
        var data=val('data'),n=bytes(data);if(n<1||n>64){toast('Callback data deve ter 1–64 bytes');return}
        attrs.push('data="'+esc(data)+'"');
      }else if(def.type==='web_app'||def.type==='login_url'){
        if(!validHttps(val('url'))){toast('Este botão exige URL HTTPS');return}
        attrs.push('url="'+esc(val('url'))+'"');
        if(def.type==='login_url'){
          if(val('forward'))attrs.push('forward-text="'+esc(val('forward'))+'"');
          if(write&&write.checked)attrs.push('request-write-access');
        }
      }else if(def.type==='switch_inline_query'||def.type==='switch_inline_query_current_chat'){
        attrs.push('query="'+esc(val('query'))+'"');
      }else if(def.type==='switch_inline_query_chosen_chat'){
        attrs.push('query="'+esc(val('query'))+'"');
        if(chosen.user.checked)attrs.push('allow-user-chats');
        if(chosen.bot.checked)attrs.push('allow-bot-chats');
        if(chosen.group.checked)attrs.push('allow-group-chats');
        if(chosen.channel.checked)attrs.push('allow-channel-chats');
      }else if(def.type==='copy_text'){
        if(!val('text')){toast('Informe o texto que será copiado');return}
        attrs.push('text="'+esc(val('text'))+'"');
      }
      var button='<tg-button '+attrs.join(' ')+'>'+esc(text)+'</tg-button>';
      var markup=inline.checked?button:'<tg-button-row align="center">\n'+button+'\n</tg-button-row>';
      insert(markup,inline.checked);
    };
    body.appendChild(form);label.focus();
  }
  function augment(){
    var headings=Array.from(body.querySelectorAll('h2'));
    var heading=headings.find(function(h){return h.textContent.trim()==='Interação'});
    if(!heading)return;
    var grid=heading.nextElementSibling;
    if(!grid||!grid.classList.contains('generator-grid')||grid.dataset.richButtonsGreen==='1')return;
    grid.innerHTML='';grid.dataset.richButtonsGreen='1';
    defs.forEach(function(def){
      var b=document.createElement('button');b.type='button';b.textContent=def.label;b.onclick=function(){showForm(def)};grid.appendChild(b);
    });
  }
  new MutationObserver(augment).observe(body,{childList:true,subtree:true});
  document.getElementById('btnInsert').addEventListener('click',function(){setTimeout(augment,0)});
  augment();
})();
</script>'''


def inject_ui(document: str) -> str:
    text = str(document or "")
    if _MARKER in text:
        return text
    closing = text.lower().rfind("</body>")
    if closing < 0:
        return text + _UI
    return text[:closing] + _UI + "\n" + text[closing:]


async def handle_callback(query: CallbackQuery) -> None:
    await query.answer()


def install(base_module, roundtrip_module) -> None:
    """Instala UI/callback; não normaliza nem reescreve estilos existentes."""
    original_serve_index = base_module.serve_index

    async def serve_index(request: web.Request):
        response = await original_serve_index(request)
        if response.status != 200:
            return response
        try:
            text = response.text
        except Exception:
            return response
        return web.Response(
            text=inject_ui(text),
            status=response.status,
            content_type="text/html",
            charset="utf-8",
            headers={
                key: value
                for key, value in response.headers.items()
                if key.lower() not in {"content-type", "content-length"}
            },
        )

    base_module.serve_index = serve_index

    original_build_dispatcher = base_module.build_dispatcher

    def build_dispatcher():
        dispatcher = original_build_dispatcher()
        dispatcher.callback_query.register(handle_callback)
        return dispatcher

    base_module.build_dispatcher = build_dispatcher
