import {Schema, DOMParser as PMDOMParser, DOMSerializer, Fragment, Slice} from "prosemirror-model";
import {EditorState, TextSelection, Selection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {history, undo, redo} from "prosemirror-history";
import {toggleMark, setBlockType, wrapIn, lift} from "prosemirror-commands";
import {keymap} from "prosemirror-keymap";
import {wrapInList, liftListItem} from "prosemirror-schema-list";

const boolAttrs = (...names) => Object.fromEntries(names.map(name => [name,{default:false}]));
const textAttrs = (...names) => Object.fromEntries(names.map(name => [name,{default:""}]));
const numAttrs = (...names) => Object.fromEntries(names.map(name => [name,{default:null}]));

function readAttrs(el,names=[],bools=[]){
  const out={};
  for(const name of names)out[name]=el.getAttribute(name)||"";
  for(const name of bools)out[name]=el.hasAttribute(name);
  return out;
}
function domAttrs(attrs,names=[],bools=[]){
  const out={};
  for(const name of names)if(attrs[name]!==""&&attrs[name]!==null&&attrs[name]!==undefined)out[name]=String(attrs[name]);
  for(const name of bools)if(attrs[name])out[name]="";
  return out;
}
function tagNode(tag,{group="block",content="inline*",attrs={},names=[],bools=[],atom=false,selectable=true}={}){
  return {
    group,content:atom?undefined:content,attrs,atom,selectable,
    parseDOM:[{tag,getAttrs:el=>readAttrs(el,names,bools)}],
    toDOM:node=>[tag,domAttrs(node.attrs,names,bools),...(atom?[]:[0])]
  };
}

const nodes={
  doc:{content:"block*"},
  paragraph:{content:"inline*",group:"block",parseDOM:[{tag:"p"},{tag:"div"}],toDOM(){return ["p",0];}},
  heading:{
    attrs:{level:{default:1}},content:"inline*",group:"block",defining:true,
    parseDOM:[1,2,3,4,5,6].map(level=>({tag:"h"+level,attrs:{level}})),
    toDOM:node=>["h"+node.attrs.level,0]
  },
  footer:{
    content:"inline*",group:"block",
    parseDOM:[{tag:"footer"},{tag:"p.tg-footer"}],
    toDOM(){return ["p",{class:"tg-footer"},0];}
  },
  blockquote:{
    attrs:{...boolAttrs("expandable")},content:"block+",group:"block",defining:true,
    parseDOM:[{tag:"blockquote",getAttrs:el=>readAttrs(el,[],["expandable"])}],
    toDOM:node=>["blockquote",domAttrs(node.attrs,[],["expandable"]),0]
  },
  aside:tagNode("aside",{group:"block",content:"inline*"}),
  pre:{content:"text*",marks:"",group:"block",code:true,defining:true,parseDOM:[{tag:"pre",preserveWhitespace:"full"}],toDOM(){return ["pre",0];}},
  horizontal_rule:{group:"block",atom:true,parseDOM:[{tag:"hr"}],toDOM(){return ["hr"];}},
  bullet_list:{content:"list_item+",group:"block",parseDOM:[{tag:"ul"}],toDOM(){return ["ul",0];}},
  ordered_list:{
    attrs:{order:{default:1},reversed:{default:false}},content:"list_item+",group:"block",
    parseDOM:[{tag:"ol",getAttrs:el=>({order:Number(el.getAttribute("start")||1)||1,reversed:el.hasAttribute("reversed")})}],
    toDOM:node=>["ol",{...(node.attrs.order!==1?{start:String(node.attrs.order)}:{}),...(node.attrs.reversed?{reversed:""}:{})},0]
  },
  list_item:{
    attrs:{value:{default:null}},content:"paragraph block*",defining:true,
    parseDOM:[{tag:"li",getAttrs:el=>({value:el.hasAttribute("value")?Number(el.getAttribute("value")):null})}],
    toDOM:node=>["li",node.attrs.value===null?{}:{value:String(node.attrs.value)},0]
  },
  task_checkbox:{
    attrs:{checked:{default:false},disabled:{default:false}},inline:true,group:"inline",atom:true,selectable:false,
    parseDOM:[{tag:"input[type=checkbox]",getAttrs:el=>({checked:el.hasAttribute("checked"),disabled:el.hasAttribute("disabled")})}],
    toDOM:node=>["input",{type:"checkbox",...(node.attrs.checked?{checked:""}:{}),...(node.attrs.disabled?{disabled:""}:{})}]
  },
  hard_break:{inline:true,group:"inline",selectable:false,parseDOM:[{tag:"br"}],toDOM(){return ["br"];}},
  figure:{group:"block",content:"(image|video|audio|document|iframe|map|figcaption)*",parseDOM:[{tag:"figure"}],toDOM(){return ["figure",0];}},
  figcaption:{content:"inline*",parseDOM:[{tag:"figcaption"}],toDOM(){return ["figcaption",0];}},
  image:{
    group:"block",atom:true,
    attrs:{...textAttrs("src","alt","data-media-id","data-media-missing","width","height")},
    parseDOM:[{tag:"img",getAttrs:el=>readAttrs(el,["src","alt","data-media-id","data-media-missing","width","height"])}],
    toDOM:node=>["img",domAttrs(node.attrs,["src","alt","data-media-id","data-media-missing","width","height"])]
  },
  video:{
    group:"block",atom:true,
    attrs:{...textAttrs("src","data-media-id","data-media-missing","width","height"),controls:{default:true}},
    parseDOM:[{tag:"video",getAttrs:el=>({...readAttrs(el,["src","data-media-id","data-media-missing","width","height"]),controls:true})}],
    toDOM:node=>["video",domAttrs({...node.attrs,controls:true},["src","data-media-id","data-media-missing","width","height"],["controls"])]
  },
  audio:{
    group:"block",atom:true,
    attrs:{...textAttrs("src","data-media-id","data-media-missing"),controls:{default:true}},
    parseDOM:[{tag:"audio",getAttrs:el=>({...readAttrs(el,["src","data-media-id","data-media-missing"]),controls:true})}],
    toDOM:node=>["audio",domAttrs({...node.attrs,controls:true},["src","data-media-id","data-media-missing"],["controls"])]
  },
  document:{
    group:"block",atom:true,
    attrs:{...textAttrs("src","data-media-id","data-media-missing")},
    parseDOM:[{tag:"tg-document",getAttrs:el=>readAttrs(el,["src","data-media-id","data-media-missing"])}],
    toDOM:node=>["tg-document",domAttrs(node.attrs,["src","data-media-id","data-media-missing"])]
  },
  iframe:{
    group:"block",atom:true,attrs:{...textAttrs("src")},
    parseDOM:[{tag:"iframe",getAttrs:el=>readAttrs(el,["src"])}],
    toDOM:node=>["iframe",domAttrs(node.attrs,["src"])]
  },
  map:{
    group:"block",atom:true,attrs:{...textAttrs("lat","long","zoom")},
    parseDOM:[{tag:"tg-map",getAttrs:el=>readAttrs(el,["lat","long","zoom"])}],
    toDOM:node=>["tg-map",domAttrs(node.attrs,["lat","long","zoom"])]
  },
  collage:{group:"block",content:"(image|video|figcaption)*",parseDOM:[{tag:"tg-collage"}],toDOM(){return ["tg-collage",0];}},
  slideshow:{group:"block",content:"(image|video|figcaption)*",parseDOM:[{tag:"tg-slideshow"}],toDOM(){return ["tg-slideshow",0];}},
  table:{
    group:"block",attrs:{...boolAttrs("bordered","striped","compact")},content:"(caption|table_section|table_row)+",
    parseDOM:[{tag:"table",getAttrs:el=>readAttrs(el,[],["bordered","striped","compact"])}],
    toDOM:node=>["table",domAttrs(node.attrs,[],["bordered","striped","compact"]),0]
  },
  caption:{content:"inline*",parseDOM:[{tag:"caption"}],toDOM(){return ["caption",0];}},
  table_section:{
    attrs:{tag:{default:"tbody"}},content:"table_row+",
    parseDOM:["thead","tbody","tfoot"].map(tag=>({tag,attrs:{tag}})),
    toDOM:node=>[node.attrs.tag,0]
  },
  table_row:{content:"(table_header|table_cell)+",parseDOM:[{tag:"tr"}],toDOM(){return ["tr",0];}},
  table_header:{
    attrs:{...textAttrs("colspan","rowspan","align","valign")},content:"inline*",
    parseDOM:[{tag:"th",getAttrs:el=>readAttrs(el,["colspan","rowspan","align","valign"])}],
    toDOM:node=>["th",domAttrs(node.attrs,["colspan","rowspan","align","valign"]),0]
  },
  table_cell:{
    attrs:{...textAttrs("colspan","rowspan","align","valign")},content:"inline*",
    parseDOM:[{tag:"td",getAttrs:el=>readAttrs(el,["colspan","rowspan","align","valign"])}],
    toDOM:node=>["td",domAttrs(node.attrs,["colspan","rowspan","align","valign"]),0]
  },
  details:{
    group:"block",attrs:{...boolAttrs("open")},content:"summary block*",
    parseDOM:[{tag:"details",getAttrs:el=>readAttrs(el,[],["open"])}],
    toDOM:node=>["details",domAttrs(node.attrs,[],["open"]),0]
  },
  summary:{content:"inline*",parseDOM:[{tag:"summary"}],toDOM(){return ["summary",0];}},
  math_block:{group:"block",content:"text*",marks:"",parseDOM:[{tag:"tg-math-block",preserveWhitespace:"full"}],toDOM(){return ["tg-math-block",0];}},
  button_row:{
    group:"block",attrs:{align:{default:"center"}},content:"button+",
    parseDOM:[{tag:"tg-button-row",getAttrs:el=>({align:el.getAttribute("align")||"center"})}],
    toDOM:node=>["tg-button-row",{align:node.attrs.align},0]
  },
  button:{
    attrs:{
      ...textAttrs("url","data","query","text","forward-text"),
      ...boolAttrs("request-write-access","allow-user-chats","allow-bot-chats","allow-group-chats","allow-channel-chats","disabled")
    },
    content:"inline*",
    parseDOM:[{tag:"tg-button",getAttrs:el=>readAttrs(el,["url","data","query","text","forward-text"],["request-write-access","allow-user-chats","allow-bot-chats","allow-group-chats","allow-channel-chats","disabled"])}],
    toDOM:node=>["tg-button",domAttrs(node.attrs,["url","data","query","text","forward-text"],["request-write-access","allow-user-chats","allow-bot-chats","allow-group-chats","allow-channel-chats","disabled"]),0]
  },
  anchor:{
    inline:true,group:"inline",atom:true,attrs:{name:{default:""}},
    parseDOM:[{tag:"a[name]:not([href])",getAttrs:el=>({name:el.getAttribute("name")||""})}],
    toDOM:node=>["a",{name:node.attrs.name}]
  },
  reference:{
    inline:true,group:"inline",content:"inline*",attrs:{name:{default:""}},
    parseDOM:[{tag:"tg-reference",getAttrs:el=>({name:el.getAttribute("name")||""})}],
    toDOM:node=>["tg-reference",{name:node.attrs.name},0]
  },
  time:{
    inline:true,group:"inline",content:"text*",attrs:{...textAttrs("unix","format")},
    parseDOM:[{tag:"tg-time",getAttrs:el=>readAttrs(el,["unix","format"])}],
    toDOM:node=>["tg-time",domAttrs(node.attrs,["unix","format"]),0]
  },
  emoji:{
    inline:true,group:"inline",content:"text*",attrs:{"emoji-id":{default:""}},
    parseDOM:[{tag:"tg-emoji",getAttrs:el=>({"emoji-id":el.getAttribute("emoji-id")||""})}],
    toDOM:node=>["tg-emoji",{"emoji-id":node.attrs["emoji-id"]},0]
  },
  text:{group:"inline"}
};

const marks={
  strong:{
    parseDOM:[{tag:"strong"},{tag:"b"},{style:"font-weight",getAttrs:value=>/^(bold(er)?|[5-9]00)$/i.test(String(value))?null:false}],
    toDOM(){return ["strong",0];}
  },
  em:{
    parseDOM:[{tag:"em"},{tag:"i"},{style:"font-style=italic"}],
    toDOM(){return ["em",0];}
  },
  underline:{
    parseDOM:[{tag:"u"},{tag:"ins"},{style:"text-decoration",getAttrs:value=>String(value).includes("underline")?null:false}],
    toDOM(){return ["u",0];}
  },
  strike:{
    parseDOM:[{tag:"s"},{tag:"strike"},{tag:"del"},{style:"text-decoration",getAttrs:value=>String(value).includes("line-through")?null:false}],
    toDOM(){return ["s",0];}
  },
  highlight:{parseDOM:[{tag:"mark"}],toDOM(){return ["mark",0];}},
  sub:{parseDOM:[{tag:"sub"}],toDOM(){return ["sub",0];}},
  sup:{parseDOM:[{tag:"sup"}],toDOM(){return ["sup",0];}},
  spoiler:{parseDOM:[{tag:"tg-spoiler"}],toDOM(){return ["tg-spoiler",0];}},
  code:{
    attrs:{class:{default:""}},excludes:"_",
    parseDOM:[{tag:"code",getAttrs:el=>({class:el.getAttribute("class")||""})}],
    toDOM:mark=>["code",mark.attrs.class?{class:mark.attrs.class}:{},0]
  },
  math:{parseDOM:[{tag:"tg-math"}],toDOM(){return ["tg-math",0];}},
  link:{
    attrs:{href:{default:""}},inclusive:false,
    parseDOM:[{tag:"a[href]",getAttrs:el=>({href:el.getAttribute("href")||""})}],
    toDOM:mark=>["a",{href:mark.attrs.href},0]
  }
};

export const schema=new Schema({nodes,marks});

function parserFor(element){return PMDOMParser.fromSchema(schema);}
function parseHTML(element,html){
  const host=element.ownerDocument.createElement("div");
  host.innerHTML=String(html||"");
  return parserFor(element).parse(host,{preserveWhitespace:"full"});
}
function parseDOM(element){return parserFor(element).parse(element,{preserveWhitespace:"full"});}
function parseDOMWithSelection(element){
  const selection=element.ownerDocument.getSelection?.();
  const points=[];
  if(selection?.rangeCount&&selection.anchorNode&&selection.focusNode&&element.contains(selection.anchorNode)&&element.contains(selection.focusNode)){
    points.push({node:selection.anchorNode,offset:selection.anchorOffset});
    points.push({node:selection.focusNode,offset:selection.focusOffset});
  }
  const doc=parserFor(element).parse(element,{preserveWhitespace:"full",findPositions:points});
  const mapped=points.length===2&&Number.isFinite(points[0].pos)&&Number.isFinite(points[1].pos)
    ?{anchor:points[0].pos,head:points[1].pos}
    :null;
  return {doc,selection:mapped};
}
function markName(command){
  return {bold:"strong",italic:"em",underline:"underline",strike:"strike",mark:"highlight",sub:"sub",sup:"sup",spoiler:"spoiler",code:"code",math:"math",createLink:"link"}[command]||"";
}
function clampPos(doc,pos){return Math.max(0,Math.min(Number.isFinite(pos)?pos:0,doc.content.size));}

export function createEditorCore({element,onChange=()=>{},onSelectionChange=()=>{}}){
  if(!element)throw new Error("Elemento do editor ausente");
  let view;
  const initial=parseDOM(element);
  const plugins=[
      history({depth:120,newGroupDelay:500}),
      keymap({
        "Mod-b":(s,d)=>toggleMark(schema.marks.strong)(s,d),
        "Mod-i":(s,d)=>toggleMark(schema.marks.em)(s,d),
        "Mod-u":(s,d)=>toggleMark(schema.marks.underline)(s,d),
        "Mod-z":undo,
        "Mod-Shift-z":redo,
        "Mod-y":redo
      })
    ];
  let state=EditorState.create({schema,doc:initial,plugins});

  function dispatchTransaction(tr){
    const docChanged=tr.docChanged;
    const notify=tr.getMeta("mdtxtrt:silent")!==true;
    state=state.apply(tr);
    view.updateState(state);
    if(docChanged&&notify)onChange({state,transaction:tr});
    if(tr.selectionSet||docChanged)onSelectionChange({state,transaction:tr});
  }
  view=new EditorView({mount:element},{state,dispatchTransaction});

  function dispatch(tr,{silent=false,addToHistory=true}={}){
    if(silent)tr.setMeta("mdtxtrt:silent",true);
    if(!addToHistory)tr.setMeta("addToHistory",false);
    view.dispatch(tr);
  }
  function domSelection(){
    const sel=element.ownerDocument.getSelection?.();
    if(!sel||!sel.rangeCount)return null;
    const anchor=sel.anchorNode,focus=sel.focusNode;
    if(!anchor||!focus||!element.contains(anchor)||!element.contains(focus))return null;
    try{
      return {
        anchor:view.posAtDOM(anchor,sel.anchorOffset),
        head:view.posAtDOM(focus,sel.focusOffset)
      };
    }catch{return null;}
  }
  function setHTML(html,{silent=true,addToHistory=false}={}){
    const doc=parseHTML(element,html);
    let tr=state.tr.replaceWith(0,state.doc.content.size,doc.content);
    tr=tr.setSelection(Selection.atEnd(tr.doc));
    dispatch(tr,{silent,addToHistory});
  }
  function resetHTML(html,{silent=true}={}){
    const doc=parseHTML(element,html);
    state=EditorState.create({schema,doc,plugins});
    view.updateState(state);
    if(!silent)onChange({state,transaction:null});
    onSelectionChange({state,transaction:null});
  }
  function syncFromDOM({silent=false,addToHistory=true}={}){
    const parsed=parseDOMWithSelection(element),next=parsed.doc,selected=parsed.selection;
    if(next.eq(state.doc)){
      if(selected){
        const anchor=clampPos(state.doc,selected.anchor),head=clampPos(state.doc,selected.head);
        try{dispatch(state.tr.setSelection(TextSelection.create(state.doc,anchor,head)),{silent:true,addToHistory:false});}catch{}
      }
      return false;
    }
    let tr=state.tr.replaceWith(0,state.doc.content.size,next.content);
    if(selected){
      const anchor=clampPos(tr.doc,selected.anchor),head=clampPos(tr.doc,selected.head);
      try{tr=tr.setSelection(TextSelection.create(tr.doc,anchor,head));}catch{tr=tr.setSelection(Selection.atEnd(tr.doc));}
    }else tr=tr.setSelection(Selection.atEnd(tr.doc));
    dispatch(tr,{silent,addToHistory});
    return true;
  }
  function captureSelection(){
    const selected=domSelection();
    if(selected){
      const anchor=clampPos(state.doc,selected.anchor),head=clampPos(state.doc,selected.head);
      try{
        const selection=TextSelection.create(state.doc,anchor,head);
        if(!selection.eq(state.selection))dispatch(state.tr.setSelection(selection),{silent:true,addToHistory:false});
      }catch{}
    }
    return state.selection.getBookmark();
  }
  function expandWord(){
    captureSelection();
    if(!state.selection.empty)return false;
    const {$from}=state.selection;
    if(!$from.parent.isTextblock)return false;
    const text=$from.parent.textContent,index=$from.parentOffset;
    let a=index,b=index;
    while(a>0&&/\S/.test(text[a-1]))a--;
    while(b<text.length&&/\S/.test(text[b]))b++;
    if(a===b)return false;
    const start=$from.start()+a,end=$from.start()+b;
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc,start,end)));
    return true;
  }
  function runMark(command,value=null){
    const name=markName(command),type=schema.marks[name];
    if(!type)throw new Error("Ação de edição indisponível");
    if(state.selection.empty)expandWord();
    const attrs=command==="createLink"?{href:String(value||"")}:null;
    if(!toggleMark(type,attrs)(state,view.dispatch))throw new Error("Selecione o texto para formatar");
    view.focus();
    return true;
  }
  function activeMark(command){
    const type=schema.marks[markName(command)];
    if(!type)return false;
    const {from,to,empty,$from}=state.selection;
    if(empty)return Boolean(type.isInSet(state.storedMarks||$from.marks()));
    return state.doc.rangeHasMark(from,to,type);
  }
  function linkHref(){
    const type=schema.marks.link;
    const marks=state.selection.empty?(state.storedMarks||state.selection.$from.marks()):state.selection.$from.marks();
    return type.isInSet(marks)?.attrs.href||"";
  }
  function currentBlockKind(){
    const {$from}=state.selection;
    for(let depth=$from.depth;depth>0;depth--){
      const node=$from.node(depth);
      if(node.type===schema.nodes.heading)return "h"+node.attrs.level;
      if(node.type===schema.nodes.footer)return "footer";
      if(node.type===schema.nodes.paragraph)return "p";
      if(node.type===schema.nodes.blockquote)return "blockquote";
      if(node.type===schema.nodes.aside)return "aside";
      if(node.type===schema.nodes.pre)return "pre";
      if(node.type===schema.nodes.list_item)return "li";
    }
    return "p";
  }
  function removeStrongFromCurrentBlock(){
    const {$from}=state.selection,depth=$from.depth;
    for(let d=depth;d>0;d--){
      const node=$from.node(d);
      if(node.isTextblock){
        const start=$from.start(d),end=start+node.content.size;
        view.dispatch(state.tr.removeMark(start,end,schema.marks.strong));
        break;
      }
    }
  }
  function formatBlock(kind){
    const current=currentBlockKind();
    const target=current===kind?"p":kind;
    if(target==="blockquote"){
      if(current==="blockquote"){lift(state,view.dispatch);return true;}
      return wrapIn(schema.nodes.blockquote)(state,view.dispatch);
    }
    if(current==="blockquote"&&target==="p"){lift(state,view.dispatch);return true;}
    let type,attrs=null;
    if(target==="footer")type=schema.nodes.footer;
    else if(/^h[1-6]$/.test(target)){type=schema.nodes.heading;attrs={level:Number(target.slice(1))};}
    else type=schema.nodes.paragraph;
    const ok=setBlockType(type,attrs)(state,view.dispatch);
    if(ok&&(target==="footer"||/^h[1-6]$/.test(target)))removeStrongFromCurrentBlock();
    view.focus();
    return ok;
  }
  function listDepth(type){
    const {$from}=state.selection;
    for(let d=$from.depth;d>0;d--)if($from.node(d).type===type)return d;
    return 0;
  }
  function toggleList(kind="ul"){
    const target=kind==="ol"?schema.nodes.ordered_list:schema.nodes.bullet_list;
    const other=kind==="ol"?schema.nodes.bullet_list:schema.nodes.ordered_list;
    const sameDepth=listDepth(target);
    if(sameDepth){liftListItem(schema.nodes.list_item)(state,view.dispatch);view.focus();return true;}
    const otherDepth=listDepth(other);
    if(otherDepth){
      const pos=state.selection.$from.before(otherDepth);
      const attrs=target===schema.nodes.ordered_list?{order:1,reversed:false}:null;
      view.dispatch(state.tr.setNodeMarkup(pos,target,attrs));
      view.focus();return true;
    }
    const ok=wrapInList(target)(state,view.dispatch);
    view.focus();
    return ok;
  }
  function insertHTML(html){
    const host=element.ownerDocument.createElement("div");
    host.innerHTML=String(html||"");
    const slice=parserFor(element).parseSlice(host,{preserveWhitespace:"full"});
    if(!slice.content.size)return false;
    dispatch(state.tr.replaceSelection(slice).scrollIntoView());
    view.focus();
    return true;
  }
  function insertText(text){
    const parts=String(text).split(/\r\n|\r|\n/),content=[];
    parts.forEach((part,index)=>{
      if(index)content.push(schema.nodes.hard_break.create());
      if(part)content.push(schema.text(part));
    });
    const slice=new Slice(Fragment.fromArray(content),0,0);
    dispatch(state.tr.replaceSelection(slice).scrollIntoView());
    view.focus();
    return true;
  }
  function folded(value){
    let text="",starts=[],ends=[];
    for(let i=0;i<value.length;){
      const cp=value.codePointAt(i),char=String.fromCodePoint(cp),fold=char.toLocaleLowerCase();
      for(let j=0;j<fold.length;j++){starts.push(i);ends.push(i+char.length);}
      text+=fold;i+=char.length;
    }
    return {text,starts,ends};
  }
  function findLiteral(term){
    term=String(term||"");
    if(!term)return [];
    const needle=folded(term).text;
    if(!needle)return [];
    const found=[];
    state.doc.descendants((node,pos)=>{
      if(!node.isTextblock)return true;
      let text="",map=[];
      node.descendants((child,rel)=>{
        if(child.isText){
          for(let i=0;i<child.text.length;i++)map.push(pos+1+rel+i);
          text+=child.text;
        }else if(child.type===schema.nodes.hard_break){
          map.push(pos+1+rel);text+="\n";
        }
        return true;
      });
      const hay=folded(text);
      let at=0;
      while((at=hay.text.indexOf(needle,at))!==-1){
        const start=hay.starts[at],end=hay.ends[at+needle.length-1];
        if(start!==undefined&&end!==undefined&&map[start]!==undefined&&map[end-1]!==undefined){
          found.push({from:map[start],to:map[end-1]+1});
        }
        at+=Math.max(1,needle.length);
      }
      return false;
    });
    return found;
  }
  function selectRange(range,{focus=false}={}){
    if(!range)return false;
    const from=clampPos(state.doc,range.from),to=clampPos(state.doc,range.to);
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc,from,to)).scrollIntoView());
    if(focus)view.focus();
    return true;
  }
  function findNext(term){
    const all=findLiteral(term);
    if(!all.length)return null;
    const cur=state.selection;
    const next=all.find(r=>r.from>cur.from||(cur.empty&&r.from===cur.from&&r.to!==cur.to))||all[0];
    selectRange(next);
    return next;
  }
  function selectedText(){return state.doc.textBetween(state.selection.from,state.selection.to,"\n","\n");}
  function selectionMatches(term){return selectedText().toLocaleLowerCase()===String(term||"").toLocaleLowerCase();}
  function replaceSelection(text){
    dispatch(state.tr.insertText(String(text),state.selection.from,state.selection.to).scrollIntoView());
    return true;
  }
  function replaceAllLiteral(term,replacement){
    const all=findLiteral(term);
    if(!all.length)return 0;
    let tr=state.tr;
    for(const range of [...all].reverse())tr=tr.insertText(String(replacement),range.from,range.to);
    dispatch(tr);
    return all.length;
  }
  function patchMedia(id,patch){
    let tr=state.tr,changed=false;
    state.doc.descendants((node,pos)=>{
      if(node.attrs?.["data-media-id"]===id){
        tr=tr.setNodeMarkup(pos,node.type,{...node.attrs,...patch},node.marks);
        changed=true;
        return false;
      }
      return true;
    });
    if(changed)dispatch(tr,{silent:true,addToHistory:false});
    return changed;
  }
  function html(){
    const holder=element.ownerDocument.createElement("div");
    holder.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content,{document:element.ownerDocument}));
    return holder.innerHTML;
  }

  return {
    get state(){return state;},
    get view(){return view;},
    schema,
    html,
    setHTML,
    resetHTML,
    syncFromDOM,
    patchMedia,
    focus:()=>view.focus(),
    saveSelection:captureSelection,
    captureSelection,
    restoreSelection:()=>view.focus(),
    expandWord,
    exec:runMark,
    activeMark,
    linkHref,
    currentBlockKind,
    toggleList,
    formatBlock,
    insertHTML,
    insertText,
    undo:()=>undo(state,view.dispatch),
    redo:()=>redo(state,view.dispatch),
    findLiteral,
    findNext,
    selectRange,
    selectedText,
    selectionEmpty:()=>state.selection.empty,
    selectionMatches,
    replaceSelection,
    replaceAllLiteral,
    destroy:()=>view.destroy()
  };
}
