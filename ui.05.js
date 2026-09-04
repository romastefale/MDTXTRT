(function(){
const editor=document.getElementById('editor');
const quickToolbar=document.getElementById('quickToolbar');
const popover=document.getElementById('popover');
if(!editor||!quickToolbar||!popover)return;
function resyncPressedState(){requestAnimationFrame(()=>editor.dispatchEvent(new Event('select')))}
quickToolbar.addEventListener('click',resyncPressedState);
new MutationObserver(resyncPressedState).observe(popover,{attributes:true,attributeFilter:['class']});
})();
