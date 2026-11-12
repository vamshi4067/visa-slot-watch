// ISOLATED world: only the background can identify the attached, running tab.
(()=>{
 const installed=Symbol.for('visa-slot-watch.bridge.0.6.1');
 if(globalThis[installed])return;
 let armed=false,revision=0;
 const apply=()=>document.documentElement?.setAttribute('data-visa-watch-armed',String(armed));
 const rootObserver=new MutationObserver(()=>{if(document.documentElement){apply();rootObserver.disconnect();}});
 if(document.documentElement)apply();else rootObserver.observe(document,{childList:true});
 async function refresh(){
  const version=++revision;
  try{const result=await chrome.runtime.sendMessage({type:'calendar-arm'});if(version!==revision)return;armed=result?.armed===true;watchVerification(result?.watchVerification);}
  catch{if(version!==revision)return;armed=false;watchVerification(false);}
  apply();
 }
 let pageObserver,signalTimer;
 function watchVerification(waiting){
  if(!waiting){
   pageObserver?.disconnect();
   pageObserver=undefined;
   if(signalTimer)clearTimeout(signalTimer);
   signalTimer=undefined;
   return;
  }
  if(pageObserver)return;
  pageObserver=new MutationObserver(()=>{
   if(signalTimer)return;
   signalTimer=setTimeout(()=>{
    signalTimer=undefined;
    chrome.runtime.sendMessage({type:'verification-page-changed'}).catch(()=>{});
   },150);
  });
  pageObserver.observe(document,{childList:true,subtree:true,characterData:true});
 }
 globalThis[installed]={refresh};
 chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local'||!changes.watch)return;
  if(changes.watch.newValue?.enabled!==true){armed=false;watchVerification(false);apply();}
  refresh();
 });
 refresh();
})();
