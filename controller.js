import {manualRoute} from './recovery.js';
import {canRecover,calendarBase,blankCalendar} from './recovery-policy.js';
import {slotMessage} from './slot-alerts.js';
import {isCalendarURL,sweepLocations,newDates,validDate} from './core.js';
export const defaults={enabled:false,tabId:null,locations:[],all:true,notifyEmpty:true,latestDate:"",interval:2,history:{},activity:[],seen:{},last:null,recovery:null,calendarURL:null,documentId:null,attachedAt:null,pendingSlotAlert:null,lease:null,generation:0,lastAttempt:0,cycle:null,lastSweep:null,delivery:null};
function recordActivity(state,kind,count=1){
  const now=Date.now();
  const recent=(state.activity||[]).filter(event=>now-event.at<24*60*60*1000).slice(-1999);
  state.activity=[...recent,{kind,count,at:now}];
}
export function makeReport(cycle,failure) {
  const observed=new Map(cycle.results.map(r=>[r.location,r]));
  if(failure)observed.set(cycle.locations[cycle.cursor],{...failure,location:cycle.locations[cycle.cursor]});
  return {type:'sweep',id:cycle.id,startedAt:cycle.startedAt,finishedAt:Date.now(),complete:!failure&&cycle.cursor===cycle.locations.length,
    locations:cycle.locations.map(location=>{const r=observed.get(location);return {location,status:r?.status||'not_checked',dates:r?.dates||[],at:r?.at||null};})};
}
export function createController(io) {
  let busy=false,configuring=false,epoch=0;
  const get=async()=>({...structuredClone(defaults),...await io.get()});
  async function stop(reason,clearDelivery=false) {
    epoch++;const s=await get();if(s.enabled)recordActivity(s,'pause');s.enabled=false;s.generation++;s.lease=null;s.recovery=null;
    if(reason)s.last={status:'unknown',reason,at:Date.now(),dates:[],location:''};
    if(clearDelivery)s.delivery=null;
    await io.set(s);await io.clearAlarm();return s;
  }
  async function attach(tabId) {
    if(busy||configuring)throw Error('Wait for the current observation to finish before attaching another tab.');
    configuring=true;
    try {
      const tab=await io.tab(tabId);if(!isCalendarURL(tab.url))throw Error('Select the logged-in OFC calendar tab, then attach it.');
      await stop();const myEpoch=epoch;const result=await io.inventory(tabId);const s=await get();
      if(epoch!==myEpoch)throw Error('Monitoring was paused during attachment.');
      Object.assign(s,{tabId,locations:result.locations||[],last:{...result,at:Date.now()},history:{},seen:{},pendingSlotAlert:null,recovery:null,calendarURL:calendarBase(tab.url),documentId:result.documentId||null,attachedAt:Date.now(),lastAttempt:0,cycle:null,lastSweep:null,delivery:null});
      await io.set(s);return s;
    }finally{configuring=false;}
  }
  async function start(settings={}) {
    if(busy||configuring)throw Error('The current check is finishing. Wait a moment before resuming.');
    configuring=true;const startEpoch=epoch;
    try {
      const s=await get();if(!s.tabId)throw Error('Attach your logged-in calendar tab first.');
      const tab=await io.tab(s.tabId);if(!isCalendarURL(tab.url))throw Error('Log in manually and return the attached tab to the OFC calendar.');
      const check=await io.inventory(s.tabId);
      if(epoch!==startEpoch)throw Error('Monitoring was paused during startup.');
      if(!['empty','available'].includes(check.status))throw Error(check.reason||'Calendar state could not be verified.');
      s.locations=check.locations||s.locations;
      s.interval=[2,5,10,15,30,60].includes(Number(settings.interval))?Number(settings.interval):2;
      s.all=settings.all!==false;s.notifyEmpty=settings.notifyEmpty===undefined?s.notifyEmpty:settings.notifyEmpty!==false;
      if(settings.latestDate!==undefined){
        if(settings.latestDate!==''&&(typeof settings.latestDate!=='string'||!validDate(settings.latestDate)))throw Error('Enter a valid latest appointment date.');
        s.latestDate=settings.latestDate;
        if(s.latestDate&&s.pendingSlotAlert){
          const dates=s.pendingSlotAlert.dates.filter(date=>date<=s.latestDate);
          s.pendingSlotAlert=dates.length?{...s.pendingSlotAlert,dates}:null;
        }
      }
      if(!sweepLocations(s.locations,s.all).length)throw Error('No requested OFC locations were found.');
      s.enabled=true;s.generation++;s.lease=null;s.recovery=null;s.calendarURL=calendarBase(tab.url);s.documentId=check.documentId||s.documentId;s.last={...check,at:Date.now()};s.cycle=null;epoch++;
      await io.set(s);
      const previousRun=s.lastSweep?.complete?(s.lastSweep.completedAt||s.lastSweep.finishedAt):s.lastAttempt;
      if(Date.now()-previousRun>=s.interval*60000)await tick();else await io.schedule(Math.max(0.5,(previousRun+s.interval*60000-Date.now())/60000));
      return get();
    }finally{configuring=false;}
  }
  async function announceDates(s,result,stillCurrent){
    const matching=[...new Set(result.dates)].filter(date=>!s.latestDate||date<=s.latestDate).sort();
    const additions=newDates(s.seen[result.location]||[],matching);
    if(!additions.length)return true;
    await io.notify('Visa slots available',slotMessage(result.location,additions),{kind:'slots'});
    if(!await stillCurrent())return false;
    recordActivity(s,'match',additions.length);
    s.pendingSlotAlert={location:result.location,dates:matching,at:result.at};
    s.seen[result.location]=[...new Set([...(s.seen[result.location]||[]),...additions])];
    if(io.whatsapp){
      try{
        s.delivery=await io.whatsapp({
          type:'slots',id:crypto.randomUUID(),location:result.location,
          earliestDate:matching[0],matchingCount:matching.length,finishedAt:result.at
        },{generation:s.generation});
      }catch(error){
        const reason=/^[a-z0-9_-]+$/.test(error?.deliveryCode||'')?error.deliveryCode:'send_error';
        s.delivery={status:'failed',reason,at:Date.now()};
      }
      if(!await stillCurrent())return false;
    }
    return true;
  }
  async function queueRecovery(s,result){
    if(!io.recover||!canRecover(result)||!calendarBase(s.calendarURL))return false;
    if(s.cycle)s.lastSweep=makeReport(s.cycle,{...result,dates:[]});
    s.cycle=null;s.lease=null;
    const retry=!!s.recovery;
    s.recovery={stage:'refresh',dueAt:Date.now()+(retry?30000:0),lastError:result.reason||'Calendar loading failed.'};
    s.last={...result,dates:[],status:'loading',reason:`${result.reason||'Calendar loading failed.'} ${retry?'Retrying in 30 seconds.':'Refreshing now.'}`,at:Date.now()};
    await io.set(s);await io.schedule(0.5);return true;
  }
  async function waitForHuman(s,result,stillCurrent){
    if(result?.status!=='challenge'||!io.recover||!calendarBase(s.calendarURL))return false;
    const now=Date.now();
    const deadline=s.recovery?.humanDeadline||now+15*60000;
    if(now>=deadline)return false;
    const first=s.recovery?.stage!=='human';
    if(first)recordActivity(s,'verification');
    if(s.cycle)s.lastSweep=makeReport(s.cycle,{...result,dates:[]});
    s.cycle=null;s.lease=null;
    s.recovery={...s.recovery,stage:'human',humanDeadline:deadline,dueAt:now+30000,lastError:result.reason};
    s.last={status:'challenge',dates:[],reason:'Complete human verification in the attached tab. Recovery will continue automatically.',at:now};
    await io.set(s);
    await io.schedule(0.5);
    if(first){
      try{await io.notify('Human verification needed','Click to open the visa tab. Complete verification there to resume monitoring.',{kind:'verification'});}catch{}
      if(io.whatsapp&&await stillCurrent()){
        let delivery;
        try{
          delivery=await io.whatsapp({type:'verification',id:crypto.randomUUID()},{generation:s.generation});
        }catch(error){
          const reason=/^[a-z0-9_-]+$/.test(error?.deliveryCode||'')?error.deliveryCode:'send_error';
          delivery={status:'failed',reason,at:Date.now()};
        }
        if(await stillCurrent()){
          const latest=await get();
          if(latest.enabled&&latest.generation===s.generation&&latest.recovery?.stage==='human'){
            await io.set({...latest,delivery});
          }
        }
      }
    }
    return true;
  }
  async function tick(wake) {
    if(busy)return;
    busy=true;const myEpoch=epoch;let claimed=false,nextWake;
    const current=async generation=>{const latest=await get();return epoch===myEpoch&&latest.generation===generation;};
    try {
      let s=await get();if(!s.enabled)return;
      if(wake&&(wake.tabId!==s.tabId||(wake.generation!==undefined&&wake.generation!==s.generation)))return;
      const early=wake&&(s.recovery?.stage==='human'||s.recovery?.fast);
      const refreshWake=wake?.refresh&&s.recovery?.stage==='refresh'&&Date.now()>=s.recovery.dueAt;
      if(wake&&!early&&!refreshWake&&!(wake.sweep&&!s.recovery))return;
      if(s.lease){await stop('An earlier check was interrupted or is still running. Review the calendar and resume manually.');return;}
      const generation=s.generation;
      if(s.recovery){
        if(!early&&Date.now()<s.recovery.dueAt){await io.schedule(Math.max(0.5,(s.recovery.dueAt-Date.now())/60000));return;}
        if((s.recovery.stage==='human'||s.recovery.fast)&&Date.now()>=s.recovery.humanDeadline){
          await stop('Verification wait expired. Complete verification and resume manually.');return;
        }
        s.lease=Date.now();await io.set(s);claimed=true;
        const step=await io.recover(s.tabId,s.recovery,{generation,calendarURL:s.calendarURL,all:s.all});
        s=await get();if(!s.enabled||!await current(generation))return;
        s.lease=null;
        if(['home','calendar','verify'].includes(step?.nextStage)){
          const fast=s.recovery.stage==='human'||s.recovery.fast;
          s.recovery={...s.recovery,fast,stage:step.nextStage,dueAt:Date.now()+(fast?0:30000)};
          if(fast&&!step.waitingForLoad)nextWake={tabId:s.tabId,generation};
          const progress={home:step.refreshTimedOut?'Refresh did not finish; waiting to open Home.':'Calendar refreshed; waiting to open Home.',calendar:'Home opened; waiting to reopen Schedule Appointment.',verify:'Calendar reopened; waiting to verify and reattach the latest document.'};
          s.last={status:'loading',reason:'Calendar recovery: '+progress[step.nextStage],dates:[],at:Date.now()};
          await io.set(s);await io.schedule(0.5);return;
        }
        if(['empty','available'].includes(step?.status)){
          const locations=step.locations;
          if(!Array.isArray(locations)||!locations.length||locations.some(name=>typeof name!=='string'||!name.trim())||!locations.includes(step.location)||!sweepLocations(locations,s.all).length)throw Error('The latest calendar VAC list could not be verified for reattachment.');
          if(step.status==='available'&&(!step.dates?.length||!step.dates.every(validDate)))throw Error('Unrecognized recovered appointment dates.');
          if(typeof step.documentId!=='string'||!step.documentId)throw Error('The latest calendar document ID could not be verified for reattachment.');
          const observation={...step,at:Date.now()};
          recordActivity(s,'check');
          if(step.status==='available'&&!await announceDates(s,observation,()=>current(generation)))return;
          s.locations=[...new Set(locations)];s.documentId=step.documentId||null;s.attachedAt=Date.now();
          if(s.recovery.fast)nextWake={tabId:s.tabId,generation,sweep:true,documentId:step.documentId};
          s.recovery=null;s.cycle=null;s.last=observation;
          await io.set(s);await io.schedule(0.5);return;
        }
        if(await waitForHuman(s,step,()=>current(generation)))return;
        if(await queueRecovery(s,step))return;
        recordActivity(s,'pause');
        s.enabled=false;s.recovery=null;
        s.last={...step,status:step?.status||'error',dates:[],reason:`Calendar recovery stopped: ${step?.reason||'No verified calendar result.'}`,at:Date.now()};
        await io.set(s);await io.clearAlarm();await io.notify('Visa Watch paused',s.last.reason);return;
      }
      if(!s.cycle){s.cycle={id:crypto.randomUUID(),startedAt:Date.now(),locations:sweepLocations(s.locations,s.all),cursor:0,results:[]};}
      s.lease=Date.now();s.lastAttempt=Date.now();await io.set(s);claimed=true;
      const target=s.cycle.locations[s.cycle.cursor];if(!target)throw Error('No configured location is available.');
      const tab=await io.tab(s.tabId);
      let result;
      if(isCalendarURL(tab.url)){
        s.calendarURL=calendarBase(tab.url);await io.set(s);
        result=await io.observe(s.tabId,target,{generation,freshDocumentId:wake?.documentId});
      }else if(blankCalendar(tab.url)&&calendarBase(s.calendarURL)){
        result={status:'error',code:tab.url?.startsWith('chrome-error:')?'PAGE_LOAD_ERROR':'PAGE_BLANK',reason:'The attached calendar document failed to load.',dates:[]};
      }else result=manualRoute(tab.pendingUrl||tab.url)||{status:'unknown',reason:'The attached tab left the supported calendar. Review sign-in or navigation manually.',dates:[]};
      s=await get();if(!s.enabled||!await current(generation))return;
      if(await waitForHuman(s,result,()=>current(generation)))return;
      if(await queueRecovery(s,result)){
        nextWake={tabId:s.tabId,generation,refresh:true};
        return;
      }
      let report=null;
      if(!result||!['empty','available'].includes(result.status)) {
        result={status:'unknown',reason:'No readable calendar result.',dates:[],...result,at:Date.now()};
        recordActivity(s,'pause');
        s.enabled=false;s.recovery=null;s.last=result;report=makeReport(s.cycle,result);s.lastSweep=report;
        await io.clearAlarm();await io.notify('Visa Watch paused',result.reason||'Review the calendar manually.');
        if(!await current(generation))return;
      } else {
        if(result.location!==target)throw Error('Location changed during observation. Results were discarded.');
        if(result.status==='available'&&(!result.dates?.length||result.dates.some(d=>!validDate(d))))throw Error('Unrecognized appointment dates.');
        recordActivity(s,'check');
        result={...result,at:Date.now()};s.last=result;s.history[target]=result;s.cycle.results.push(result);s.cycle.cursor++;
        if(result.status==='empty'&&s.notifyEmpty){
          const checked=new Date(result.at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'});
          await io.notify('Visa Watch · no slots',`${target}: No Slots Available. Checked ${checked}. This check covers this location only.`);
          if(!await current(generation))return;
        }
        if(result.status==='available'&&!await announceDates(s,result,()=>current(generation)))return;
        if(s.cycle.cursor===s.cycle.locations.length){report=makeReport(s.cycle);s.lastSweep=report;s.cycle=null;}
      }
      await io.set(s);
      if(!await current(generation))return;
      if(report){
        if(report.complete){
          const labels={empty:'No Slots Available',available:'Dates found',not_checked:'Not checked',login:'Login required',blocked:'Access blocked',challenge:'Verification required',loading:'Loading incomplete',unknown:'Unknown',error:'Check failed'};
          const summary=report.locations.map(r=>`${r.location}: ${labels[r.status]||'Unknown'}${r.dates?.length?` (${r.dates.join(', ')})`:''}`).join('\n');
          await io.notify('Visa Watch · sweep complete',summary);
          if(!await current(generation))return;
        }
        if(report.complete&&io.email){
          try{const delivery=await io.email(report,{generation});if(delivery)s.emailDelivery={...delivery,at:Date.now()};}
          catch(e){s.emailDelivery={status:'failed',reason:String(e?.message||'Email send failed.'),at:Date.now()};}
          if(!await current(generation))return;
          await io.set(s);
          if(!await current(generation))return;
        }
        try{s.delivery=io.whatsapp?await io.whatsapp(report,{generation}):{status:'not_configured'};}
        catch(e){
          if(!await current(generation))return;
          const reason=/^[a-z0-9_-]+$/.test(e?.deliveryCode||'')?e.deliveryCode:'send_error';
          s.delivery={status:'failed',reason,at:Date.now()};
        }
        if(!await current(generation))return;
      }
      if(report?.complete&&s.lastSweep?.id===report.id)s.lastSweep.completedAt=Date.now();
      s.lease=null;await io.set(s);
      if(s.enabled){const delay=s.cycle?0.5:s.interval;await io.schedule(delay);}
    }catch(e){
      const s=await get();if(epoch!==myEpoch)return;
      if(s.enabled)recordActivity(s,'pause');
      s.enabled=false;s.lease=null;s.recovery=null;s.last={status:'error',reason:String(e.message||e),at:Date.now(),dates:[]};
      await io.set(s);await io.clearAlarm();
      if(!await current(s.generation))return;
      if(s.cycle&&s.lastSweep?.id!==s.cycle.id){
        const report=makeReport(s.cycle,s.last);s.lastSweep=report;
        await io.set(s);
        if(!await current(s.generation))return;
        try{s.delivery=io.whatsapp?await io.whatsapp(report,{generation:s.generation,allowPaused:true}):{status:'not_configured'};}
        catch(e){s.delivery={status:'failed',reason:/^[a-z0-9_-]+$/.test(e?.deliveryCode||'')?e.deliveryCode:'send_error',at:Date.now()};}
        if(!await current(s.generation))return;
        await io.set(s);
      }
    }finally{
      if(claimed){const s=await get();if(s.lease){s.lease=null;await io.set(s);}}
      busy=false;
      if(nextWake)io.wake?.(nextWake);
    }
  }
  async function acknowledgeSlotAlert(){
    if(busy||configuring)throw Error('Wait for the current observation to finish before acknowledging.');
    busy=true;
    try{const s=await get();s.pendingSlotAlert=null;await io.set(s);return s;}finally{busy=false;}
  }
  return {get,start,stop,attach,tick,acknowledgeSlotAlert};
}
