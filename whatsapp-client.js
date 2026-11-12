import {formatWebReport} from './whatsapp-web.js';
const codedError=(code,message)=>Object.assign(Error(message),{deliveryCode:code});
export const WHATSAPP_ORIGIN='https://web.whatsapp.com/*';
export function createWebMessenger(io){
  let busy=false;
  return {async send(report,context={}){
    const settings=await io.settings();
    if(!settings.enabled||settings.mode!=='web')return {status:'not_configured'};
    if(['slots','verification','sweep'].includes(report.type)&&settings.alerts?.[report.type]===false){
      return {status:'filtered'};
    }
    if(!/^[1-9]\d{7,14}$/.test(settings.number||'')||!Number.isInteger(settings.tabId))throw codedError('invalid_settings','Configure the WhatsApp recipient and dedicated tab.');
    if(busy)throw codedError('busy','Another WhatsApp send is running.');busy=true;
    try{
      const journal={pending:null,sent:[],...await io.journal()};
      if(journal.sent.includes(report.id))return {status:'submitted',duplicate:true,at:Date.now()};
      if(journal.pending)throw codedError('interrupted_send','A WhatsApp send was interrupted. Check receipt manually before clearing its send lock.');
      const tab=await io.tab(settings.tabId);if(new URL(tab.url).origin!=='https://web.whatsapp.com')throw codedError('tab_unavailable','The dedicated WhatsApp tab is unavailable.');
      const text=formatWebReport(report);journal.pending=report.id;await io.save(journal);
      const result=await io.submit(settings.tabId,{mode:'send',number:settings.number,text,tabId:settings.tabId,generation:context.generation,allowPaused:context.allowPaused});
      if(result.status!=='submitted'){
        const safe=['recipient_unverified','controls_unavailable','draft','paused','wrong_page','invalid_request'];
        if(safe.includes(result.status)){journal.pending=null;await io.save(journal);}
        throw codedError(result.status,`WhatsApp did not submit the report (${result.status}). No automatic retry.`);
      }
      journal.pending=null;journal.sent=[...journal.sent,report.id].slice(-500);await io.save(journal);
      return {status:'submitted',at:Date.now()};
    }finally{busy=false;}
  }};
}
