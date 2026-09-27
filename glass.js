const material=el=>{
  el.dataset.liquidGlass='material';
  el.style.backdropFilter='blur(6px) saturate(1.15)';
  el.style.webkitBackdropFilter='blur(6px) saturate(1.15)';
  const edge=document.createElement('span');
  edge.setAttribute('aria-hidden','true');
  edge.dataset.lgLayer='';
  Object.assign(edge.style,{position:'absolute',inset:'0',pointerEvents:'none',borderRadius:'inherit',boxShadow:'inset 0 1px 0 rgba(255,255,255,.55),inset 0 0 0 1px rgba(255,255,255,.12)'});
  el.append(edge);
};
document.querySelectorAll('[data-lg]').forEach(material);
