import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const root=new URL('../',import.meta.url);

test('all chrome surfaces initialize the same liquid-glass material runtime',()=>{
  const dom=new JSDOM(readFileSync(new URL('index.html',root),'utf8'),{
    url:'https://mdtxtrt.example/',
    runScripts:'outside-only',
    pretendToBeVisual:true
  });
  const w=dom.window,d=w.document;
  Object.defineProperty(w.navigator,'userAgent',{value:'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36',configurable:true});
  Object.defineProperty(w.navigator,'userAgentData',{value:{brands:[{brand:'Chromium',version:'130'}]},configurable:true});
  const callbacks=[];
  w.ResizeObserver=class{
    constructor(callback){callbacks.push(callback);}
    observe(){}
    disconnect(){}
  };
  w.HTMLElement.prototype.getBoundingClientRect=function(){
    if(!this.hasAttribute('data-lg'))return {width:0,height:0,top:0,left:0,right:0,bottom:0};
    const width=this.id==='typebar'?760:this.classList.contains('sheet')?350:160;
    const height=this.classList.contains('sheet')?220:48;
    return {width,height,top:0,left:0,right:width,bottom:height};
  };
  const maps=[];
  w.HTMLCanvasElement.prototype.getContext=function(){
    return {
      createImageData:(width,height)=>({data:new w.Uint8ClampedArray(width*height*4)}),
      putImageData:image=>maps.push(image.data.slice())
    };
  };
  let dataUrl=0;
  w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,map'+(++dataUrl);

  w.eval(readFileSync(new URL('glass.js',root),'utf8'));
  d.dispatchEvent(new w.Event('DOMContentLoaded'));

  const targets=[...d.querySelectorAll('[data-lg]')];
  assert.equal(targets.length,13);
  assert.equal(targets.filter(el=>el.dataset.liquidGlass==='material').length,13);
  assert.equal(maps.length,13);

  const ids=targets.map(el=>el.querySelector('filter')?.id);
  assert.equal(ids.every(Boolean),true);
  assert.equal(new Set(ids).size,13);
  for(const el of targets){
    assert.match(el.style.backdropFilter,/^blur\(6px\) saturate\(1\.15\) url\(#lg-mat-\d+-v\d+\)$/);
    assert.ok(el.querySelector('[data-lg-layer]'));
  }
  assert.match(d.querySelector('#typebar').style.backdropFilter,/url\(#lg-mat-/);
  dom.window.close();
});
