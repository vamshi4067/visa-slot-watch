import {canRecover,calendarBase,blankCalendar} from './recovery-policy.js';
import {isCalendarURL,sweepLocations} from './core.js';
import {readSnapshot,visible} from './adapter.js';
const missingScheduleLink='A unique visible Schedule Appointment link was not found on Home.';
const hosts=['www.usvisascheduling.com','usvisascheduling.com'];
export function isHomeURL(value){try{const u=new URL(value);return u.protocol==='https:'&&hosts.includes(u.hostname)&&/^\/en-US\/?$/i.test(u.pathname);}catch{return false;}}
export function inspectRecoveryHome(doc,url,{isVisible=visible}={}){
 const snapshot=readSnapshot(doc,url,{isVisible});
 if(snapshot.blocked)return {status:'blocked',reason:'Access blocked during recovery.'};
 if(snapshot.challenge)return {status:'challenge',reason:'Complete verification manually before resuming.'};
 if(snapshot.login)return {status:'login',reason:'Sign in manually before resuming.'};
 if(snapshot.error)return {status:'error',code:'CALENDAR_LOAD_ERROR',reason:'Home reports a page-load error.'};
 if(!isHomeURL(url))return {status:'unknown',reason:'The expected Home page is not open.'};
 const links=[...doc.querySelectorAll('a[href]')].filter(a=>isVisible(a)&&/^Schedule Appointment$/i.test(a.textContent.trim()));
 if(links.length!==1)return {status:'unknown',reason:missingScheduleLink};
 try{
  const target=new URL(links[0].getAttribute('href'),url);
  if(target.origin!==new URL(url).origin||!isCalendarURL(target.href)||target.search||target.hash)throw Error('Unexpected destination');
  return {status:'ready',url:target.href};
 }catch{return {status:'unknown',reason:'Schedule Appointment does not point to the expected same-origin calendar.'};}
}
export function manualRoute(value){
 try{
  const u=new URL(value);
  if(u.hostname==='atlasauth.b2clogin.com'||/\/(?:sign[-_]?in|login|account\/login)(?:\/|$)/i.test(u.pathname))return {status:'login',reason:'Sign-in navigation requires manual attention.'};
  if(u.protocol==='https:'&&hosts.includes(u.hostname)&&/\/cdn-cgi\//i.test(u.pathname))return {status:'challenge',reason:'Verification navigation requires manual attention.'};
 }catch{}
 return null;
}
export function createRecoveryNavigator(io){
 return async(tabId,recovery,{generation,calendarURL,all=true})=>{
  await io.guard(tabId,generation);
  const tab=await io.tab(tabId),url=tab.url||'';
  const base=calendarBase(calendarURL)||calendarBase(url);
  if(!base)return {status:'unknown',reason:'A previously verified calendar address is required.'};
  const expectedOrigin=new URL(base).origin;
  const manual=manualRoute(tab.pendingUrl)||manualRoute(url);if(manual)return manual;
  const placeholder=blankCalendar(url);
  try{
   if(tab.pendingUrl&&(new URL(tab.pendingUrl).origin!==expectedOrigin||(!isCalendarURL(tab.pendingUrl)&&!isHomeURL(tab.pendingUrl))))return {status:'unknown',reason:'A sign-in or unexpected navigation is pending. Review manually.'};
   if(!placeholder&&new URL(url).origin!==expectedOrigin)return {status:'unknown',reason:'Recovery left the attached calendar origin. Sign-in or verification may require manual attention.'};
  }catch{return {status:'unknown',reason:'The recovery address could not be verified.'};}
  if(!placeholder&&!isCalendarURL(url)&&!isHomeURL(url))return {status:'unknown',reason:'Recovery left the expected Home/calendar route. Review manually.'};
  if(recovery.stage==='human'){
   const waiting={status:'challenge',reason:'Complete human verification in the attached tab. Recovery will continue automatically.'};
   if(tab.status==='loading'||tab.pendingUrl||placeholder)return waiting;
   if(isHomeURL(url)){
    const home=await io.home(tabId);
    if(home.status==='ready')return {nextStage:'calendar'};
    return home.reason===missingScheduleLink?waiting:home;
   }
   const probe=await io.probe(tabId);
   if(probe.status==='loading')return waiting;
   if(['empty','available'].includes(probe.status)||canRecover(probe))return {nextStage:'home'};
   return probe;
  }
  const checkCalendar=async()=>{
   if(!isCalendarURL(url))return null;
   const probe=io.probe?await io.probe(tabId):null;
   if(probe&&!['empty','available','loading'].includes(probe.status)&&!canRecover(probe))return probe;
   return null;
  };
  if(recovery.stage==='refresh'){
   const stop=await checkCalendar();if(stop)return stop;
   await io.guard(tabId,generation);
   if(placeholder)await io.navigate(tabId,base);
   else if(isCalendarURL(url)||isHomeURL(url)){
    if(isHomeURL(url)){const home=await io.home(tabId);if(home.status!=='ready'&&!canRecover(home))return home;}
    await io.guard(tabId,generation);
    try{await io.reload(tabId);}catch{
     await io.guard(tabId,generation);
     return {nextStage:'home',refreshTimedOut:true};
    }
   }
   return {nextStage:'home'};
  }
  if(recovery.fast&&(tab.status==='loading'||tab.pendingUrl))return {nextStage:recovery.stage,waitingForLoad:true};
  if(recovery.stage!=='home'&&(tab.status==='loading'||tab.pendingUrl))return {status:'loading',code:'PAGE_LOADING',reason:'Recovery navigation has not finished.'};
  if(recovery.stage==='home'){
   const stop=await checkCalendar();if(stop)return stop;
   if(isHomeURL(url)){const home=await io.home(tabId);if(home.status!=='ready'&&!canRecover(home))return home;}
   if(!isHomeURL(url)){await io.guard(tabId,generation);await io.navigate(tabId,new URL('/en-US/',base).href);}
   return {nextStage:'calendar'};
  }
  if(recovery.stage==='calendar'){
   if(!isCalendarURL(url)){
    if(!isHomeURL(url))return {status:'unknown',reason:'Home was not reached before reopening Schedule Appointment.'};
    const home=await io.home(tabId);
    if(recovery.fast&&home.status==='unknown'&&home.reason===missingScheduleLink)return {nextStage:'calendar',waitingForLoad:true};
    if(home.status!=='ready')return home;
    const next=new URL(home.url);
    if(next.origin!==expectedOrigin||!isCalendarURL(next.href)||next.search||next.hash)return {status:'unknown',reason:'Unexpected recovery calendar destination.'};
    await io.guard(tabId,generation);await io.navigate(tabId,next.href);
   }
   return {nextStage:'verify'};
  }
  if(recovery.stage==='verify'&&isCalendarURL(url)){
   const probe=await io.probe?.(tabId);
   if(['challenge','login','blocked'].includes(probe?.status))return probe;
   const location=sweepLocations(probe?.locations||[],all)[0];
   if(recovery.fast&&!location&&(probe?.status==='loading'||probe?.code==='CALENDAR_UNREADABLE')){
    return {nextStage:'verify',waitingForLoad:true};
   }
   await io.guard(tabId,generation);
   return io.inspect(tabId,{location,generation});
  }
  return {status:'unknown',reason:'Recovery state could not be verified.'};
 };
}
