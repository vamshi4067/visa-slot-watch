// MAIN world: never collect alert contents or expose extension APIs to the page.
(()=>{
 if(window.alert.__visaSlotWatchDetector==='0.6.1')return;
 const nativeAlert=window.alert;
 const detector=function(message){
  if(document.documentElement?.getAttribute('data-visa-watch-armed')==='true'&&typeof message==='string'&&/\bPSE0501\b/.test(message)&&/Unable to load appointment available days at this time/i.test(message)){
   document.documentElement.setAttribute('data-visa-watch-error','PSE0501');
   return;
  }
  return Reflect.apply(nativeAlert,this,arguments);
 };
 Object.defineProperty(detector,'__visaSlotWatchDetector',{value:'0.6.1'});
 window.alert=detector;
})();
