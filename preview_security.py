"""Protege a prévia realmente servida pelo Mini App antes de qualquer innerHTML."""
from __future__ import annotations

from aiohttp import web

_MARKER = "mdtxtrt-preview-sanitizer"

_GUARD = r'''<script id="mdtxtrt-preview-sanitizer">
(function(){
  function safeUrl(value,kind){
    var raw=String(value||'').trim();
    if(kind==='href'&&raw.charAt(0)==='#')return raw;
    if(kind==='src'&&/^\/media\/[A-Za-z0-9_-]+$/.test(raw))return raw;
    try{
      var url=new URL(raw,location.origin),p=url.protocol.toLowerCase();
      if(p==='https:'||p==='http:')return url.href;
      if(kind==='href'&&(p==='mailto:'||p==='tel:'||p==='tg:'))return raw;
    }catch(e){}
    return '';
  }
  function sanitize(raw){
    var template=document.createElement('template');
    template.innerHTML=String(raw||'');
    var allowed=new Set(['a','aside','audio','b','blockquote','br','code','del','details','div','em','figcaption','figure','footer','h1','h2','h3','h4','h5','h6','hr','i','img','input','li','mark','ol','p','pre','s','span','strong','sub','summary','sup','table','tbody','td','tfoot','th','thead','tr','u','ul','video','tg-button-row','tg-button','tg-collage','tg-document','tg-emoji','tg-map','tg-math','tg-math-block','tg-reference','tg-slideshow','tg-time']);
    var attrs={
      a:new Set(['href','title','name']),div:new Set(['class']),span:new Set(['class']),
      img:new Set(['src','alt','title','tg-spoiler']),
      video:new Set(['src','controls','tg-spoiler']),audio:new Set(['src','controls']),
      details:new Set(['open']),table:new Set(['bordered','striped','compact']),
      td:new Set(['align','valign','colspan','rowspan']),th:new Set(['align','valign','colspan','rowspan']),
      input:new Set(['type','checked']),
      'tg-button-row':new Set(['align']),'tg-button':new Set(['type','url','text','style','data','query','forward-text','request-write-access','allow-user-chats','allow-bot-chats','allow-group-chats','allow-channel-chats']),
      'tg-map':new Set(['lat','long','zoom','width','height']),'tg-emoji':new Set(['emoji-id']),
      'tg-time':new Set(['unix','format']),'tg-reference':new Set(['name'])
    };
    var safeClasses=new Set(['preview-note','spoiler','revealed']);
    var nodes=[],walker=document.createTreeWalker(template.content,NodeFilter.SHOW_ELEMENT);
    while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(function(el){
      var tag=el.tagName.toLowerCase();
      if(!allowed.has(tag)){el.replaceWith.apply(el,Array.from(el.childNodes));return;}
      var keep=attrs[tag]||new Set();
      Array.from(el.attributes).forEach(function(attr){
        var name=attr.name.toLowerCase();
        if(!keep.has(name)){el.removeAttribute(attr.name);return;}
        if(name==='class'){
          var classes=String(attr.value||'').split(/\s+/).filter(function(v){return safeClasses.has(v);});
          if(classes.length)el.setAttribute('class',classes.join(' '));else el.removeAttribute('class');
        }
        if(tag==='a'&&name==='href'){
          var href=safeUrl(attr.value,'href');if(href)el.setAttribute('href',href);else el.removeAttribute('href');
        }
        if((tag==='img'||tag==='video'||tag==='audio')&&name==='src'){
          var src=safeUrl(attr.value,'src');if(src)el.setAttribute('src',src);else el.removeAttribute('src');
        }
      });
      if(tag==='input'){
        if(String(el.getAttribute('type')||'').toLowerCase()!=='checkbox'){el.replaceWith(document.createTextNode(''));return;}
        el.setAttribute('disabled','');
      }
    });
    return template.innerHTML;
  }
  if(window.marked&&typeof window.marked.parse==='function'){
    var original=window.marked.parse.bind(window.marked);
    window.marked.parse=function(){return sanitize(original.apply(null,arguments));};
  }
  var preview=document.getElementById('preview');
  var descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  if(preview&&descriptor&&descriptor.get&&descriptor.set){
    Object.defineProperty(preview,'innerHTML',{
      configurable:true,
      get:function(){return descriptor.get.call(this);},
      set:function(value){descriptor.set.call(this,sanitize(value));}
    });
  }
})();
</script>'''


def inject_preview_guard(document: str) -> str:
    text = str(document or "")
    if _MARKER in text:
        return text
    closing = text.lower().rfind("</body>")
    if closing < 0:
        return text + _GUARD
    return text[:closing] + _GUARD + "\n" + text[closing:]


def install(base_module) -> None:
    original = base_module.serve_index

    async def serve_index(request: web.Request):
        response = await original(request)
        if response.status != 200:
            return response
        try:
            text = response.text
        except Exception:
            return response
        return web.Response(
            text=inject_preview_guard(text),
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
