"""Entrega de Rich Messages longas sem cortar estruturas nem deslocar mídia."""
from __future__ import annotations

import re

from aiogram.types import InputRichMessage, ReplyParameters

RICH_CHAR_LIMIT = 32768
RICH_BLOCK_LIMIT = 500
RICH_NESTING_LIMIT = 16
RICH_MEDIA_LIMIT = 50
RICH_TABLE_COLUMN_LIMIT = 20

_MEDIA_REF_RE = re.compile(r"tg://(?:photo|video|audio|document)\?id=([A-Za-z0-9_-]+)", re.IGNORECASE)
_MARKDOWN_MEDIA_RE = re.compile(r"!\[[^\]]*\]\((?:https?://|tg://(?:photo|video|audio|document)\?id=)[^)\s]+(?:\s+\"[^\"]*\")?\)", re.IGNORECASE)
_HTML_MEDIA_RE = re.compile(r"<(?:img|video|audio|tg-document)\b", re.IGNORECASE)
_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
_PAIRED_START_RE = re.compile(r"^\s*<(details|blockquote|aside|table|figure|ul|ol|footer|p|h[1-6]|tg-button-row|tg-collage|tg-slideshow)\b", re.IGNORECASE)
_TAG_RE = re.compile(r"</?\s*([A-Za-z0-9-]+)\b[^>]*>", re.IGNORECASE)
_BLOCK_TAGS = {"p","h1","h2","h3","h4","h5","h6","pre","footer","hr","blockquote","aside","ul","ol","li","table","tr","details","figure","tg-map","tg-button-row","tg-collage","tg-slideshow","tg-math-block","img","video","audio","tg-document"}
_NESTING_TAGS = _BLOCK_TAGS | {"b","strong","i","em","u","ins","s","strike","del","code","mark","sub","sup","a","tg-spoiler","tg-emoji","tg-time","tg-reference","figcaption","caption","th","td"}
_SELF_CLOSING_TAGS = {"hr","img","input","tg-map"}


def _structural_blocks(text: str) -> list[str]:
    lines=(text or "").replace("\r\n","\n").replace("\r","\n").split("\n"); blocks=[]; ordinary=[]; i=0
    def flush():
        if ordinary: blocks.append("\n".join(ordinary)); ordinary.clear()
    while i < len(lines):
        line=lines[i]; stripped=line.strip()
        if not stripped: flush(); i+=1; continue
        fence=_FENCE_RE.match(line)
        if fence:
            flush(); marker=fence.group(1); block=[line]; i+=1
            while i < len(lines):
                block.append(lines[i])
                if re.match(rf"^\s*{re.escape(marker[0])}{{{len(marker)},}}\s*$",lines[i]): i+=1; break
                i+=1
            blocks.append("\n".join(block)); continue
        if stripped.startswith("$$"):
            flush(); block=[line]; closed=len(stripped)>4 and stripped.endswith("$$"); i+=1
            if not closed:
                while i < len(lines):
                    block.append(lines[i])
                    if "$$" in lines[i]: i+=1; break
                    i+=1
            blocks.append("\n".join(block)); continue
        paired=_PAIRED_START_RE.match(line)
        if paired:
            flush(); tag=paired.group(1).lower(); op=re.compile(rf"<{re.escape(tag)}\b",re.I); cl=re.compile(rf"</{re.escape(tag)}\s*>",re.I); block=[line]; depth=len(op.findall(line))-len(cl.findall(line)); i+=1
            while depth>0 and i<len(lines):
                block.append(lines[i]); depth+=len(op.findall(lines[i])); depth-=len(cl.findall(lines[i])); i+=1
            blocks.append("\n".join(block)); continue
        ordinary.append(line); i+=1
    flush(); return [b for b in blocks if b]


def _html_block_count(text:str)->int:
    return sum(1 for m in _TAG_RE.finditer(text or "") if not m.group(0).lstrip().startswith("</") and m.group(1).lower() in _BLOCK_TAGS)


def _markdown_block_count(text:str)->int:
    count=0; in_fence=False; fence_char=""; in_quote=in_list=in_para=in_table=False
    for line in (text or "").splitlines():
        s=line.strip(); fence=_FENCE_RE.match(line)
        if fence:
            if not in_fence: count+=1; in_fence=True; fence_char=fence.group(1)[0]
            elif s.startswith(fence_char*3): in_fence=False; fence_char=""
            continue
        if in_fence: continue
        if not s: in_quote=in_list=in_para=in_table=False; continue
        if s.startswith("<"): in_quote=in_list=in_para=in_table=False; continue
        if s.startswith("|") and s.endswith("|"):
            if not in_table: count+=1; in_table=True
            count+=1; in_para=False; continue
        if re.match(r"^#{1,6}\s+",s) or re.match(r"^(---+|\*\*\*+)$",s): count+=1; in_quote=in_list=in_para=in_table=False; continue
        if s.startswith(">"):
            if not in_quote: count+=1; in_quote=True
            in_list=in_para=in_table=False; continue
        if re.match(r"^(?:[-*+]|\d+\.)\s+",s):
            if not in_list: count+=1; in_list=True
            count+=1; in_quote=in_para=in_table=False; continue
        if _MARKDOWN_MEDIA_RE.search(s): count+=len(_MARKDOWN_MEDIA_RE.findall(s)); in_quote=in_list=in_para=in_table=False; continue
        if not in_para: count+=1; in_para=True
        in_quote=in_list=in_table=False
    return count


def _block_count(text:str)->int: return _html_block_count(text)+_markdown_block_count(text)


def _max_nesting(text:str)->int:
    stack=[]; maximum=0
    for m in _TAG_RE.finditer(text or ""):
        token=m.group(0); name=m.group(1).lower()
        if name not in _NESTING_TAGS: continue
        if token.lstrip().startswith("</"):
            for index in range(len(stack)-1,-1,-1):
                if stack[index]==name: del stack[index:]; break
        elif not (token.rstrip().endswith("/>") or name in _SELF_CLOSING_TAGS):
            stack.append(name); maximum=max(maximum,len(stack))
    return maximum


def _media_count(text:str)->int: return len(_MARKDOWN_MEDIA_RE.findall(text or ""))+len(_HTML_MEDIA_RE.findall(text or ""))


def _max_table_columns(text:str)->int:
    maximum=0
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>",text or "",re.I|re.S):
        columns=0
        for cell in re.finditer(r"<(?:th|td)\b([^>]*)>",row,re.I|re.S):
            colspan=re.search(r"\bcolspan\s*=\s*(?:\"(\d+)\"|'(\d+)'|(\d+))",cell.group(1),re.I)
            columns+=max(1,next((int(x) for x in colspan.groups() if x),1)) if colspan else 1
        maximum=max(maximum,columns)
    for line in (text or "").splitlines():
        s=line.strip()
        if s.startswith("|") and s.endswith("|"): maximum=max(maximum,len(re.split(r"(?<!\\)\|",s[1:-1])))
    return maximum


def rich_structure_metrics(text:str)->dict[str,int]:
    return {"characters":len(text or ""),"blocks":_block_count(text or ""),"nesting":_max_nesting(text or ""),"media":_media_count(text or ""),"table_columns":_max_table_columns(text or "")}


def validate_rich_structure(text:str,*,enforce_size:bool=True,enforce_blocks:bool=True,enforce_media:bool=True)->dict[str,int]:
    m=rich_structure_metrics(text)
    if enforce_size and m["characters"]>RICH_CHAR_LIMIT: raise ValueError(f"Rich Message excede {RICH_CHAR_LIMIT} caracteres e precisa de divisão estrutural segura.")
    if enforce_blocks and m["blocks"]>RICH_BLOCK_LIMIT: raise ValueError(f"Rich Message excede {RICH_BLOCK_LIMIT} blocos e precisa de divisão estrutural segura.")
    if m["nesting"]>RICH_NESTING_LIMIT: raise ValueError(f"Rich Message excede a profundidade máxima de {RICH_NESTING_LIMIT} níveis.")
    if enforce_media and m["media"]>RICH_MEDIA_LIMIT: raise ValueError(f"Rich Message excede {RICH_MEDIA_LIMIT} mídias e precisa de divisão estrutural segura.")
    if m["table_columns"]>RICH_TABLE_COLUMN_LIMIT: raise ValueError(f"Tabela Rich excede o máximo de {RICH_TABLE_COLUMN_LIMIT} colunas.")
    return m


def _plain_block_can_split(block:str)->bool: return not re.search(r"[<>`*_~\[\]|]",block) and not _MARKDOWN_MEDIA_RE.search(block)


def _split_plain_block(block:str,limit:int)->list[str]:
    if len(block)<=limit: return [block]
    if not _plain_block_can_split(block): raise ValueError(f"Um bloco Rich excede o limite de {limit} caracteres e não pode ser dividido sem alterar a estrutura.")
    result=[]; remaining=block
    while len(remaining)>limit:
        cut=remaining.rfind("\n",0,limit+1)
        if cut<limit//2: cut=remaining.rfind(" ",0,limit+1)
        if cut<=0: cut=limit
        result.append(remaining[:cut]); remaining=remaining[cut:].lstrip("\n ")
    if remaining: result.append(remaining)
    return result


def split_structural_chunks(text:str,limit:int=RICH_CHAR_LIMIT)->list[str]:
    if limit<=0: raise ValueError("O limite de chunk precisa ser positivo.")
    blocks=[]
    for original in _structural_blocks(text or ""): blocks.extend(_split_plain_block(original,limit) if len(original)>limit else [original])
    chunks=[]; current=""
    for block in blocks:
        bm=validate_rich_structure(block,enforce_size=False,enforce_blocks=False,enforce_media=False)
        if bm["characters"]>limit: raise ValueError(f"Um bloco Rich excede o limite de {limit} caracteres e não pode ser dividido sem perda.")
        if bm["blocks"]>RICH_BLOCK_LIMIT: raise ValueError(f"Um único bloco estrutural excede {RICH_BLOCK_LIMIT} blocos aninhados e não pode ser dividido com segurança.")
        if bm["media"]>RICH_MEDIA_LIMIT: raise ValueError(f"Um único bloco estrutural contém mais de {RICH_MEDIA_LIMIT} mídias e não pode ser dividido com segurança.")
        candidate=block if not current else current+"\n\n"+block; m=rich_structure_metrics(candidate)
        if m["characters"]<=limit and m["blocks"]<=RICH_BLOCK_LIMIT and m["media"]<=RICH_MEDIA_LIMIT: current=candidate; continue
        if current: validate_rich_structure(current); chunks.append(current)
        current=block
    if current: validate_rich_structure(current); chunks.append(current)
    return chunks or [""]


def media_for_chunk(chunk:str,media)->list:
    ids=set(_MEDIA_REF_RE.findall(chunk or "")); return [item for item in (media or []) if str(getattr(item,"id","")) in ids] if ids else []


def install(base_module)->None:
    async def send_rich_message(bot,chat_id,content:str,reply_to_message_id=None,*,message_thread_id=None,direct_messages_topic_id=None,business_connection_id=None,ephemeral_message_parameters=None):
        rich=base_module.build_rich_message(content); chunks=split_structural_chunks(rich.markdown or ""); media=rich.media or []
        for idx,chunk in enumerate(chunks):
            validate_rich_structure(chunk); reply=ReplyParameters(message_id=reply_to_message_id) if idx==0 and reply_to_message_id else None; chunk_media=media_for_chunk(chunk,media)
            if len(chunk_media)>RICH_MEDIA_LIMIT: raise ValueError(f"Chunk Rich excede o limite oficial de {RICH_MEDIA_LIMIT} mídias.")
            await bot.send_rich_message(chat_id=chat_id,rich_message=InputRichMessage(markdown=chunk,media=chunk_media or None,is_rtl=rich.is_rtl),reply_parameters=reply,message_thread_id=message_thread_id,direct_messages_topic_id=direct_messages_topic_id,business_connection_id=business_connection_id,ephemeral_message_parameters=ephemeral_message_parameters,request_timeout=60)
    base_module.send_rich_message=send_rich_message
