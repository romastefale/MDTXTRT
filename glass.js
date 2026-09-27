/*
 * Liquid Glass material adaptation.
 * Reference: https://github.com/romastefale/liquid-glass
 * Pinned reference revision: 4e7b769e1df7e5a7d3669fef22417fe3d2f79ade
 * Upstream: @samasante/liquid-glass, © Sam Asante, MIT License.
 * This plain-JavaScript adaptation preserves attribution; see PROVENANCE.md and LICENSE.
 */


const ERF_K=Math.sqrt(Math.PI);
const erf=x=>Math.tanh(ERF_K*x);
const domeGradientMean=(r,h)=>h>0?(r-Math.sqrt(r*r-h*h))/h:0;
const computeDomeConstants=(d,w,h)=>{
  const c=Math.max(.01,Math.min(d,Math.min(w,h)-1));
  const x=(w*w+c*c)/(2*c),y=(h*h+c*c)/(2*c);
  const mx=domeGradientMean(x,w),my=domeGradientMean(y,h);
  return {Rx:x,Ry:y,scaleX:mx>0 ? .5/mx : 1,scaleY:my>0 ? .5/my : 1};
};
const domeGradient=(d,r,s)=>{
  const x=Math.min(d,r*(1-1e-3));
  return x/Math.sqrt(r*r-x*x)*s;
};
const encodeAxis=x=>((.5+x)*255+.5)|0;
const encodeSpec=x=>(127*x+128+.5)|0;

const createLensMapGenerator=size=> {
  let canvas=null;
  let ctx=null;
  let image=null;
  let domeLut=null;
  let lutDome = -Infinity;
  let lutHalfW = -Infinity;
  let lutHalfH = -Infinity;
  let lutLen = 0;
  let lutDirty = true;
  let dome=null;

  return {
    generate(shape) {
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        ctx = canvas.getContext("2d");
        image = ctx.createImageData(size, size);
      }
      const {
        lensHalfWidth: halfW,
        lensHalfHeight: halfH,
        borderRadius,
        depth,
        clipToShape,
        softEdge,
        sheenAngle = 45,
        glow = 0,
        glowSpread = 1,
        glowFalloff = 1.5,
        sheen = 0,
        sheenWidth = 3,
        sheenFalloff = 1.5,
        curvature = 0,
        splay = 0,
        bend = 0,
        bendWidth = 0.16,
      } = shape;
      const data = image.data;
      const half = size >> 1;
      const radius = Math.min(borderRadius, Math.min(halfW, halfH));

      const minHalf = Math.min(halfW, halfH);
      const depthPx = Math.min(depth * minHalf, minHalf - 1);
      const innerHalfW = Math.max(0, halfW - depthPx);
      const innerHalfH = Math.max(0, halfH - depthPx);
      const innerRadius = Math.max(
        0,
        Math.min(borderRadius, Math.min(innerHalfW, innerHalfH)),
      );

      const falloff = depthPx > 0 ? Math.SQRT1_2 / depthPx : 1e6;
      const hasSpecular = glow > 0 || sheen > 0;
      const angle = (sheenAngle * Math.PI) / 180;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const edgeInv = sheenWidth > 0 ? 1 / sheenWidth : 0;

      const glowReachInv = 1 / Math.max(2, glowSpread * Math.min(halfW, halfH));
      const stepX = (2 * halfW) / size;
      const stepY = (2 * halfH) / size;
      const invW = 1 / halfW;
      const invH = 1 / halfH;
      const hasDome = curvature > 0;

      const domeCap = curvature * Math.min(halfW, halfH);
      const hasSplay = splay > 0;

      const hasEdgeRefract = bend > 0;
      const erInv = 1 / Math.max(2, bendWidth * Math.min(halfW, halfH));

      const cornerDistance=(ox,oy)=>
        ox > 0 || oy > 0 ? Math.sqrt(ox * ox + oy * oy) : 0;

      if (hasDome) {
        if (
          !dome ||
          Math.abs(domeCap - lutDome) > 0.5 ||
          Math.abs(halfW - lutHalfW) > 1 ||
          Math.abs(halfH - lutHalfH) > 1
        ) {
          dome = computeDomeConstants(domeCap, halfW, halfH);
          lutDome = domeCap;
          lutHalfW = halfW;
          lutHalfH = halfH;
          lutDirty = true;
        }
        if (lutLen !== half) {
          domeLut = new Float32Array(half);
          lutLen = half;
          lutDirty = true;
        }
        if (lutDirty) {
          const lut = domeLut;
          const d = dome;
          const r2 = d.Rx * d.Rx;
          const rMax = d.Rx * (1 - 1e-3);
          for (let col = 0; col < half; col += 1) {
            const px = -((col + 0.5) * stepX - halfW);
            const clamped = px < rMax ? px : rMax;
            lut[col] = (clamped / Math.sqrt(r2 - clamped * clamped)) * d.scaleX;
          }
          lutDirty = false;
        }
      }
      const lut = hasDome ? domeLut : null;
      const splayHalf = 0.5 * Math.min(halfW, halfH);
      const splayInv = splayHalf > 0 ? 1 / splayHalf : 0;
      const sheenNorm = Math.SQRT1_2; // 1/√2: normalizes the diagonal projection

      for (let row = 0; row < half; row += 1) {
        const mirrorRow = size - 1 - row;
        const py = -((row + 0.5) * stepY - halfH);
        const edgeY = py - halfH + radius;
        const innerEdgeY = softEdge ? py - innerHalfH + innerRadius : 0;
        const dirYBase =
          hasDome && lut
            ? domeGradient(py, dome.Ry, dome.scaleY)
            : py * invH > 1
              ? 1
              : py * invH;
        const normY = py * invH > 1 ? 1 : py * invH;
        const splayY = hasSplay ? Math.max(0, 1 - (halfH - py) * splayInv) : 0;
        const rowBase = row * size;
        const mirrorRowBase = mirrorRow * size;
        for (let col = 0; col < half; col += 1) {
          const mirrorCol = size - 1 - col;
          const px = -((col + 0.5) * stepX - halfW);
          const edgeX = px - halfW + radius;
          const sdf =
            cornerDistance(edgeX > 0 ? edgeX : 0, edgeY > 0 ? edgeY : 0) +
            (edgeX > edgeY ? (edgeX > 0 ? 0 : edgeX) : edgeY > 0 ? 0 : edgeY) -
            radius;

          const i00 = (rowBase + col) * 4; // top-left  (canonical)
          const i01 = (rowBase + mirrorCol) * 4; // top-right (mirror X)
          const i10 = (mirrorRowBase + col) * 4; // bottom-left (mirror Y)
          const i11 = (mirrorRowBase + mirrorCol) * 4; // bottom-right (mirror XY)

          if (clipToShape && sdf >= 0) {

            for (const idx of [i00, i01, i10, i11]) {
              data[idx] = 128;
              data[idx + 1] = 128;
              data[idx + 2] = 128;
              data[idx + 3] = 255;
            }
            continue;
          }

          let dirX = lut ? lut[col] : px * invW > 1 ? 1 : px * invW;
          let dirY = dirYBase;
          if (hasSplay) {
            const yAtt = splayY * splay;
            const xAtt = Math.max(0, 1 - (halfW - px) * splayInv) * splay;
            if (yAtt > 0.001 || xAtt > 0.001) {
              const prevX = dirX;
              const prevY = dirY;
              dirX = prevX * (1 - yAtt);
              dirY = prevY * (1 - xAtt);
              const prevLen = Math.sqrt(prevX * prevX + prevY * prevY);
              const nextLen = Math.sqrt(dirX * dirX + dirY * dirY);
              if (nextLen > 0.001) {
                const restore = prevLen / nextLen;
                dirX *= restore;
                dirY *= restore;
              }
            }
          }

          let edgeOpacity = 1;
          if (softEdge) {
            const ix = px - innerHalfW + innerRadius;
            const innerSdf =
              cornerDistance(ix > 0 ? ix : 0, innerEdgeY > 0 ? innerEdgeY : 0) +
              (ix > innerEdgeY
                ? ix > 0
                  ? 0
                  : ix
                : innerEdgeY > 0
                  ? 0
                  : innerEdgeY) -
              innerRadius;
            edgeOpacity = 0.5 * (1 + erf(innerSdf * falloff));
          }

          let dx = 0.5 * dirX * edgeOpacity;
          let dy = 0.5 * dirY * edgeOpacity;
          if (hasEdgeRefract) {

            const s = sdf < 0 ? Math.max(0, 1 + sdf * erInv) : 0;
            if (s > 0) {
              const len = Math.sqrt(dirX * dirX + dirY * dirY);
              if (len > 1e-4) {
                const m = 6.75 * s * s * (1 - s);
                const a = (0.5 * bend * m * edgeOpacity) / len;
                dx += dirX * a;
                dy += dirY * a;
              }
            }
          }

          let specMain = 0;
          let specCross = 0;
          if (hasSpecular) {
            const normX = px * invW > 1 ? 1 : px * invW;

            const axisMain = Math.min(
              1,
              Math.abs(normX * cosA + normY * sinA) * sheenNorm,
            );
            const axisCross = Math.min(
              1,
              Math.abs(normX * cosA - normY * sinA) * sheenNorm,
            );

            if (sheen > 0) {
              const band = sdf < 0 ? Math.max(0, 1 + sdf * edgeInv) : 0;
              const b = sheen * Math.pow(band, sheenFalloff);
              specMain += b * (0.16 + 0.84 * Math.pow(axisMain, 1.6));
              specCross += b * (0.16 + 0.84 * Math.pow(axisCross, 1.6));
            }

            if (glow > 0) {

              const reach = sdf < 0 ? Math.min(1, -sdf * glowReachInv) : 1;
              const t = 1 - reach;
              const g =
                glow * Math.pow(t * t * (3 - 2 * t), glowFalloff) * edgeOpacity;
              specMain += g * (0.6 + 0.4 * axisMain);
              specCross += g * (0.6 + 0.4 * axisCross);
            }
            if (specMain > 1) specMain = 1;
            else if (specMain < -1) specMain = -1;
            if (specCross > 1) specCross = 1;
            else if (specCross < -1) specCross = -1;
          }

          const rPos = encodeAxis(dx);
          const rNeg = encodeAxis(-dx);
          const gPos = encodeAxis(dy);
          const gNeg = encodeAxis(-dy);
          const bMain = encodeSpec(specMain);
          const bCross = encodeSpec(specCross);

          data[i00] = rPos;
          data[i00 + 1] = gPos;
          data[i00 + 2] = bMain;
          data[i00 + 3] = 255;
          data[i01] = rNeg;
          data[i01 + 1] = gPos;
          data[i01 + 2] = bCross;
          data[i01 + 3] = 255;
          data[i10] = rPos;
          data[i10 + 1] = gNeg;
          data[i10 + 2] = bCross;
          data[i10 + 3] = 255;
          data[i11] = rNeg;
          data[i11 + 1] = gNeg;
          data[i11 + 2] = bMain;
          data[i11 + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      return canvas.toDataURL();
    },
    dispose() {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas = null;
      }
      ctx = null;
      image = null;
      domeLut = null;
      dome = null;
      lutDome = -Infinity;
      lutHalfW = -Infinity;
      lutHalfH = -Infinity;
      lutLen = 0;
      lutDirty = true;
    },
  };
}

const O={mapSize:512,clipToShape:true,softEdge:true,strength:.05,depth:.5,curvature:.3,splay:0,dispersion:.32,bend:.45,bendWidth:.16,frost:6,saturate:1.15,brightness:0,specular:1,sheenAngle:45,sheen:.32,sheenWidth:3,sheenFalloff:1.5,glow:.1,glowSpread:1,glowFalloff:.5};
const CONTEXT_MENU_OPTICS={mapSize:256,clipToShape:true,softEdge:true,depth:.65,curvature:.26,dispersion:.16,strength:.22,bend:.65,bendWidth:.07,frost:3.5,brightness:.55,specular:.8,sheenAngle:45,glow:.06,glowSpread:1,glowFalloff:.8,sheen:.4,sheenWidth:1};
const D=.22;
const N="http://www.w3.org/2000/svg";
const node=(n,a={})=>{
  const e=document.createElementNS(N,n);
  for(const [k,v] of Object.entries(a))e.setAttribute(k,String(v));
  return e;
};
const supportsBackdropUrl=()=>{
  const ua=navigator.userAgent||'';
  const hasUAData=navigator.userAgentData!=null;
  const blink=hasUAData||((ua.includes('Chrome/')||ua.includes('Chromium/')||ua.includes('Edg/'))&&!/iPhone|iPad|iPod/.test(ua)&&!['CriOS','EdgiOS','FxiOS','OPiOS'].some(x=>ua.includes(x)));
  return blink;
};
let materialSeq=0;
const material=el=>{
  if(el.dataset.liquidGlass)return;
  const mode=el.dataset.lgMode==="frost"?"frost":"material";
  const profile=el.dataset.lgProfile==="context-menu"?"context-menu":"material";
  const optics=profile==="context-menu"?{...O,...CONTEXT_MENU_OPTICS}:O;
  const supportsRefraction=mode==="material"&&supportsBackdropUrl();
  el.dataset.liquidGlass=mode;
  el.dataset.lgProfileResolved=profile;
  el.dataset.lgRendering=mode==="frost"?"frost":supportsRefraction?"material-refraction":"material-frost";
  const frost="blur("+optics.frost+"px) saturate("+optics.saturate+")";
  const edge=document.createElement('span');
  edge.setAttribute('aria-hidden','true');
  edge.dataset.lgLayer='';
  Object.assign(edge.style,{position:'absolute',inset:'0',pointerEvents:'none',borderRadius:'inherit',boxShadow:profile==="context-menu"?"none":'inset 0 1px 0 rgba(255,255,255,.55), inset 0 0 0 1px rgba(255,255,255,.12)'});
  el.append(edge);
  if(mode==="frost"||!supportsRefraction){
    el.style.backdropFilter=frost;
    el.style.webkitBackdropFilter=frost;
    if(profile==="context-menu"&&optics.brightness>0)el.style.background="rgba(255,255,255,"+optics.brightness+")";
    return;
  }
  const svg=node("svg",{width:0,height:0,"aria-hidden":"true"});
  svg.dataset.lgLayer="";
  Object.assign(svg.style,{position:"absolute",width:"0",height:"0"});
  const defs=node("defs"),f=node("filter",{filterUnits:"userSpaceOnUse",primitiveUnits:"userSpaceOnUse",colorInterpolationFilters:"sRGB"});
  const flood=node("feFlood",{floodColor:"rgb(128,128,128)",floodOpacity:"1",result:"mapBg"});
  const img=node("feImage",{preserveAspectRatio:"none",result:"rawMap"});
  const comp=node("feComposite",{in:"rawMap",in2:"mapBg",operator:"over",result:"map"});
  const r=node("feDisplacementMap",{in:"SourceGraphic",in2:"map",xChannelSelector:"R",yChannelSelector:"G"});
  const rc=node("feColorMatrix",{type:"matrix",values:"1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",result:"refractR"});
  const g=node("feDisplacementMap",{in:"SourceGraphic",in2:"map",xChannelSelector:"R",yChannelSelector:"G"});
  const gc=node("feColorMatrix",{type:"matrix",values:"0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",result:"refractG"});
  const b=node("feDisplacementMap",{in:"SourceGraphic",in2:"map",xChannelSelector:"R",yChannelSelector:"G"});
  const bc=node("feColorMatrix",{type:"matrix",values:"0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",result:"refractB"});
  const rg=node("feComposite",{in:"refractR",in2:"refractG",operator:"arithmetic",k1:"0",k2:"1",k3:"1",k4:"0",result:"refractRG"});
  const rgb=node("feComposite",{in:"refractRG",in2:"refractB",operator:"arithmetic",k1:"0",k2:"1",k3:"1",k4:"0",result:"lensOut"});
  const sm=node("feColorMatrix",{in:"map",type:"matrix",values:"0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 -0.5019607843",result:"sheenMask"});
  const sc=node("feComposite",{in:"sheenMask",in2:"lensOut",operator:"arithmetic",k1:"0",k2:String(optics.specular),k3:"1",k4:"0",result:"specOut"});
  const brightness=optics.brightness>0?node("feFlood",{floodColor:"white",floodOpacity:String(optics.brightness),result:"brightnessVeil"}):null;
  const bright=brightness?node("feComposite",{in:"brightnessVeil",in2:"specOut",operator:"over"}):null;
  f.append(flood,img,comp,r,rc,g,gc,b,bc,rg,rgb,sm,sc);
  if(bright)f.append(brightness,bright);
  defs.append(f);svg.append(defs);el.append(svg);
  const gen=createLensMapGenerator(optics.mapSize);
  const materialId=++materialSeq;
  let v=0;
  const draw=()=>{
    const x=el.getBoundingClientRect();
    if(!x.width||!x.height)return;
    const cs=getComputedStyle(el);
    const rad=Math.min(parseFloat(cs.borderTopLeftRadius)||0,Math.min(x.width,x.height)/2);
    const map=gen.generate({lensHalfWidth:x.width/2,lensHalfHeight:x.height/2,borderRadius:rad,depth:optics.depth,clipToShape:optics.clipToShape,softEdge:optics.softEdge,sheenAngle:optics.sheenAngle,glow:optics.glow,glowSpread:optics.glowSpread,glowFalloff:optics.glowFalloff,sheen:optics.sheen,sheenWidth:optics.sheenWidth,sheenFalloff:optics.sheenFalloff,curvature:optics.curvature,splay:optics.splay,bend:optics.bend,bendWidth:optics.bendWidth});
    const scale=optics.strength*Math.sqrt((x.width*x.width+x.height*x.height)/2);
    const margin=Math.ceil(scale*1.2*.5+28);
    img.setAttribute("href",map);img.setAttribute("width",x.width);img.setAttribute("height",x.height);
    r.setAttribute("scale",scale*(1+D*optics.dispersion));
    g.setAttribute("scale",scale*(1+D*.5*optics.dispersion));
    b.setAttribute("scale",scale);
    f.setAttribute("x",-margin);f.setAttribute("y",-margin);f.setAttribute("width",x.width+2*margin);f.setAttribute("height",x.height+2*margin);
    f.id="lg-mat-"+materialId+"-v"+(++v);
    const value=frost+" url(#"+f.id+")";
    el.style.backdropFilter=value;
    el.style.webkitBackdropFilter=value;
  };
  draw();
  new ResizeObserver(draw).observe(el);
};
const init=()=>document.querySelectorAll("[data-lg]").forEach(material);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
