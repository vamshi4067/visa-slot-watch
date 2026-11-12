import {isCalendarURL} from './core.js';
export function createDetectorInstaller(api){
 return async tabId=>{
  const tab=await api.tabs.get(tabId);
  if(!isCalendarURL(tab.url))throw Error('Open the supported calendar before installing its error detector.');
  await api.scripting.executeScript({target:{tabId},world:'MAIN',files:['portal-alert.js']});
  await api.scripting.executeScript({target:{tabId},world:'ISOLATED',files:['portal-bridge.js']});
  const results=await api.scripting.executeScript({target:{tabId},world:'ISOLATED',func:async id=>{
   const bridge=globalThis[Symbol.for('visa-slot-watch.bridge.0.6.1')];
   if(!document.documentElement||typeof bridge?.refresh!=='function')return {ready:false};
   // The bridge owns all arming writes and invalidates older replies on Pause.
   await bridge.refresh();
   return {ready:document.documentElement.getAttribute('data-visa-watch-armed')!==null};
  },args:[tabId]});
  if(!results[0]?.result?.ready)throw Error('The calendar error detector could not be installed. Monitoring has not continued.');
 };
}
