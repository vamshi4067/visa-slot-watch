import {createDetectorInstaller} from './detector.js';
import {isCalendarURL} from './core.js';
import {createRecoveryNavigator,isHomeURL} from './recovery.js';
import {createAlertDelivery,slotMessage,verificationSpeech} from './slot-alerts.js';
import {speakAlert} from './voice-alert.js';
import {createGmailSender,formatSweepEmail,validEmailAddress} from './email.js';
import {createController} from './controller.js';
import {createCalendarObserver} from './page-observer.js';
import {createWebMessenger,WHATSAPP_ORIGIN} from './whatsapp-client.js';
const ALARM='visa-slot-watch';
const emailSender=interactive=>createGmailSender({getToken:async()=>{
  const result=await chrome.identity.getAuthToken({interactive});
  return result?.token;
}});
async function sendEmail(report){
  const {email}=await chrome.storage.local.get('email');
  if(!email?.enabled)return null;
  await emailSender(false)({to:email.to,subject:'Visa Slot Watch - sweep report',body:formatSweepEmail(report)});
  return {status:'sent',at:Date.now()};
}
const ensureDetector=createDetectorInstaller(chrome);
async function inject(tabId,request,{readOnly=false}={}) {
  if(!readOnly)await ensureDetector(tabId);
  const results=await chrome.scripting.executeScript({target:{tabId},func:async request=>{
    const {inspectPage}=await import(chrome.runtime.getURL('adapter.js'));
    return inspectPage(request);
  },args:[request]});
  if(!results[0]?.result)throw Error('Calendar inspection returned no result.');
  return {...results[0].result,documentId:results[0].documentId||null};
}
async function reloadOnce(tabId) {
  // The listener precedes the reload so a fast load cannot be missed.
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(Error('Page loading timed out. No retry was attempted.'));},15000);
    function cleanup(){clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);}
    function listener(id,change){if(id===tabId&&change.status==='complete'){cleanup();resolve();}}
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.reload(tabId).catch(e=>{cleanup();reject(e);});
  });
}
const verificationNotificationId='visa-human-verification';
const notify=createAlertDelivery({
  visual:async(title,message,options)=>{
    if(await chrome.notifications.getPermissionLevel()!=='granted')throw Error('Desktop notification permission is disabled. Enable it and resume.');
    const verification=options.kind==='verification';
    const id=verification?verificationNotificationId:`visa-${crypto.randomUUID()}`;
    await chrome.notifications.create(id,{
      type:'basic',iconUrl:'icon.png',title,message,
      priority:verification?2:1,
      requireInteraction:verification||options.kind==='slots',
      silent:verification||options.kind==='slots'
    });
  },
  muted:async()=> (await chrome.storage.local.get('slotSoundMuted')).slotSoundMuted===true,
  sound:async(text)=>{
    try{await speakAlert(chrome.tts,text);await chrome.storage.local.set({slotSoundError:null});}
    catch(e){await chrome.storage.local.set({slotSoundError:'Voice alert could not play. Use a voice test to check audio.'});throw e;}
  }
});
async function webAction(tabId,request){
  const injection=chrome.scripting.executeScript({target:{tabId},func:async request=>{
    const {runWebSender}=await import(chrome.runtime.getURL('whatsapp-web.js'));
    return runWebSender(request);
  },args:[request]});
  let timer;
  try{
    const results=request.mode==='verify'
      ?await Promise.race([injection,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Recipient verification timed out after 10 seconds.')) ,10000);})])
      :await injection;
    return results[0]?.result||{status:'controls_unavailable'};
  }finally{clearTimeout(timer);}
}
const messenger=createWebMessenger({
  settings:async()=> (await chrome.storage.local.get('whatsapp')).whatsapp||{},
  journal:async()=> (await chrome.storage.local.get('whatsappJournal')).whatsappJournal||{},
  save:whatsappJournal=>chrome.storage.local.set({whatsappJournal}),
  tab:id=>chrome.tabs.get(id),submit:webAction
});
async function whatsapp(report,context={}){
  return messenger.send(report,{...context,allowPaused:report.type==='sweep'&&!report.complete});
}
async function guardMonitor(id,generation){
  const {watch}=await chrome.storage.local.get('watch');
  if(!watch?.enabled||watch.generation!==generation||watch.tabId!==id)throw Error('Monitoring paused.');
}
const recoverCalendar=createRecoveryNavigator({
  guard:guardMonitor,reload:reloadOnce,probe:id=>inject(id,{mode:'inventory'},{readOnly:true}),tab:id=>chrome.tabs.get(id),navigate:(id,url)=>chrome.tabs.update(id,{url}),
  home:async id=>{
    const results=await chrome.scripting.executeScript({target:{tabId:id},func:async()=>{
      const {inspectRecoveryHome}=await import(chrome.runtime.getURL('recovery.js'));
      return inspectRecoveryHome(document,location.href);
    }});
    return results[0]?.result||{status:'unknown',reason:'Home could not be inspected.'};
  },
  inspect:(id,request)=>inject(id,{...request,mode:'recovery'})
});
const controller=createController({
  email:sendEmail,recover:recoverCalendar,
  get:async()=> (await chrome.storage.local.get('watch')).watch||{},
  set:async watch=>{
    await chrome.storage.local.set({watch});
    const verification=watch.enabled&&watch.recovery?.stage==='human';
    await chrome.action.setBadgeText({text:verification?'WAIT':watch.pendingSlotAlert?'SLOT':watch.enabled?'ON':watch.last?'!':''});
    await chrome.action.setBadgeBackgroundColor({color:verification?'#a66620':watch.pendingSlotAlert?'#b34700':watch.enabled?'#177d66':'#a66620'});
  },
  tab:id=>chrome.tabs.get(id),clearAlarm:()=>chrome.alarms.clear(ALARM),
  wake:request=>setTimeout(()=>controller.tick(request).catch(console.error),0),
  schedule:minutes=>chrome.alarms.create(ALARM,{delayInMinutes:minutes}),
  inventory:id=>inject(id,{mode:'inventory'}),
  observe:createCalendarObserver({
    tab:id=>chrome.tabs.get(id),
    guard:guardMonitor,
    inventory:id=>inject(id,{mode:'inventory'}),inspect:inject,reload:reloadOnce,
    record:async event=>{
      const {watchDiagnostics}=await chrome.storage.local.get('watchDiagnostics');
      const recent=Array.isArray(watchDiagnostics)?watchDiagnostics.slice(-29):[];
      // Only fixed page categories and statuses; never URL queries, cookies or page contents.
      await chrome.storage.local.set({watchDiagnostics:[...recent,event]});
    }
  }),notify,whatsapp
});
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name===ALARM)controller.tick().catch(console.error);
});
chrome.tabs.onUpdated.addListener((tabId,change)=>{
  if(change.status==='complete')controller.tick({tabId}).catch(console.error);
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.type==='verification-page-changed'){
    if(sender.id!==chrome.runtime.id||sender.frameId!==0||!sender.tab||(!isCalendarURL(sender.url)&&!isHomeURL(sender.url)))return false;
    controller.tick({tabId:sender.tab.id}).then(()=>respond({ok:true})).catch(()=>respond({ok:false}));
    return true;
  }
  // Content scripts may ask only whether this exact attached calendar is armed.
  if(message.type==='calendar-arm'){
    if(sender.id!==chrome.runtime.id||!sender.tab||sender.frameId!==0||(!isCalendarURL(sender.url)&&!isHomeURL(sender.url)))return false;
    controller.get().then(s=>{
      const attached=s.enabled===true&&s.tabId===sender.tab.id;
      respond({armed:attached&&isCalendarURL(sender.url),watchVerification:attached&&(s.recovery?.stage==='human'||s.recovery?.fast===true)});
    }).catch(()=>respond({armed:false}));
    return true;
  }
  // Only extension UI can control the monitor; page scripts cannot invoke it.
  if(sender.id!==chrome.runtime.id||sender.tab)return false;
  (async()=>{
    if(message.type==='slot-ack')return controller.acknowledgeSlotAlert();
    if(message.type==='slot-mute'){await chrome.storage.local.set({slotSoundMuted:message.muted===true});return {};}
    if(message.type==='slot-sound-test'||message.type==='verification-sound-test'){
      const text=message.type==='verification-sound-test'
        ?verificationSpeech
        :slotMessage('Hyderabad VAC',['2027-01-15']);
      await speakAlert(chrome.tts,text);
      await chrome.storage.local.set({slotSoundError:null});
      return {};
    }
    if(message.type==='status'){
      const {whatsapp,whatsappJournal,email,emailTestDelivery}=await chrome.storage.local.get(['whatsapp','whatsappJournal','email','emailTestDelivery']);
      const {slotSoundMuted,slotSoundError}=await chrome.storage.local.get(['slotSoundMuted','slotSoundError']);
      const state=await controller.get();
      return {...state,slotSoundMuted:slotSoundMuted===true,slotSoundError,whatsappEnabled:whatsapp?.mode==='web'&&whatsapp.enabled===true,whatsappAlerts:whatsapp?.alerts,whatsappNumber:whatsapp?.mode==='web'?whatsapp.number:'',whatsappAttached:!!whatsapp?.tabId,sendLock:!!whatsappJournal?.pending,emailEnabled:email?.enabled===true,emailRecipient:email?.to||'',emailConnected:email?.connected===true,emailDelivery:state.emailDelivery||emailTestDelivery,nextCheck:(await chrome.alarms.get(ALARM))?.scheduledTime,notificationPermission:await chrome.notifications.getPermissionLevel()};
    }
    if(message.type==='attach')return controller.attach(message.tabId);
    if(message.type==='start')return controller.start(message.settings);
    if(message.type==='stop')return controller.stop();
    if(message.type==='test'){await notify('Visa Watch test','Test notification only. No appointment availability has been detected.');return {};}
    if(message.type==='email-settings'){
      const s=await controller.get();if(s.enabled)throw Error('Pause monitoring before changing email settings.');
      const current=(await chrome.storage.local.get('email')).email||{};
      if(!message.enabled){await chrome.storage.local.set({email:{enabled:false,to:message.to||current.to||'',connected:current.connected===true},emailTestDelivery:null});return {};}
      const to=String(message.to||'').trim();if(!validEmailAddress(to))throw Error('Enter a valid recipient email address.');
      await chrome.storage.local.set({email:{enabled:true,to,connected:current.connected===true&&current.to===to},emailTestDelivery:null});return {};
    }
    if(message.type==='email-connect'){
      const s=await controller.get();if(s.enabled)throw Error('Pause monitoring before connecting Gmail.');
      const email=(await chrome.storage.local.get('email')).email||{};if(!email.enabled||!validEmailAddress(email.to))throw Error('Save and enable the recipient address first.');
      await chrome.identity.getAuthToken({interactive:true});
      await chrome.storage.local.set({email:{...email,connected:true}});return {};
    }
    if(message.type==='email-test'){
      const email=(await chrome.storage.local.get('email')).email||{};if(!email.enabled||!validEmailAddress(email.to))throw Error('Enable and save a valid recipient first.');
      const now=Date.now();
      await emailSender(true)({to:email.to,subject:'Visa Slot Watch - test email',body:'This is a test email from Visa Slot Watch. Email alerts are configured. No appointment availability was detected by this test.'});
      const emailDelivery={status:'sent',test:true,at:now};await chrome.storage.local.set({email:{...email,connected:true},emailTestDelivery:emailDelivery});return {emailDelivery};
    }
    if(message.type==='whatsapp-alerts'){
      const {whatsapp}=await chrome.storage.local.get('whatsapp');
      const alerts={slots:message.slots===true,verification:message.verification===true,sweep:message.sweep===true};
      await chrome.storage.local.set({whatsapp:{...whatsapp,alerts}});
      return {};
    }
    if(message.type==='whatsapp-settings'){
      const s=await controller.get();if(s.enabled)throw Error('Pause monitoring before changing WhatsApp settings.');
      const {whatsapp:previous}=await chrome.storage.local.get('whatsapp');
      if(!message.enabled){await chrome.storage.local.set({whatsapp:{...previous,mode:'web',enabled:false}});return {};}
      const number=String(message.number||'').replace(/[^0-9]/g,'');
      if(!/^[1-9]\d{7,14}$/.test(number))throw Error('Enter the full recipient number with country code.');
      if(!await chrome.permissions.contains({origins:[WHATSAPP_ORIGIN]}))throw Error('Allow WhatsApp Web access in Chrome first.');
      const [active]=await chrome.tabs.query({active:true,currentWindow:true});
      const tab=active?.url?.startsWith('https://web.whatsapp.com/')?active:(await chrome.tabs.query({url:'https://web.whatsapp.com/*'})).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];
      if(!tab?.id)throw Error('Open the dedicated recipient chat in WhatsApp Web first.');
      const result=await webAction(tab.id,{mode:'verify',number});
      if(result.status!=='ready')throw Error(`Recipient not verified (${result.status}). Open the target contact info; no chat messages were read.`);
      await chrome.storage.local.set({whatsapp:{...previous,mode:'web',enabled:true,number,tabId:tab.id}});return {};
    }
    if(message.type==='whatsapp-test'){
      const now=Date.now();const delivery=await whatsapp({type:'test',id:crypto.randomUUID(),startedAt:now,finishedAt:now,complete:true,locations:[]});
      if(delivery.status!=='submitted')throw Error('Configure the WhatsApp Web recipient first.');
      return {delivery};
    }
    if(message.type==='whatsapp-unlock'){
      const s=await controller.get();if(s.enabled)throw Error('Pause monitoring first.');
      const {whatsappJournal}=await chrome.storage.local.get('whatsappJournal');
      await chrome.storage.local.set({whatsappJournal:{...whatsappJournal,pending:null}});return {};
    }
    if(message.type==='open'){
      const s=await controller.get();
      if(s.tabId){try{const t=await chrome.tabs.update(s.tabId,{active:true});await chrome.windows.update(t.windowId,{focused:true});return {};}catch{}}
      await chrome.tabs.create({url:'https://www.usvisascheduling.com/en-US/ofc-schedule/'});return {};
    }
    throw Error('Unknown command');
  })().then(state=>respond({ok:true,state})).catch(e=>respond({ok:false,error:e.message}));
  return true;
});
chrome.storage.onChanged.addListener((changes,area)=>{
  const watch=changes.watch;
  if(area==='local'&&watch?.oldValue?.recovery?.stage==='human'&&watch.newValue?.recovery?.stage!=='human'){
    chrome.notifications.clear(verificationNotificationId).catch(console.error);
  }
});
chrome.notifications.onClicked.addListener(async id=>{
  if(id==='visa-test')return;
  const s=await controller.get();if(s.tabId)try{const tab=await chrome.tabs.update(s.tabId,{active:true});await chrome.windows.update(tab.windowId,{focused:true});}catch{}
});
chrome.tabs.onRemoved.addListener(async id=>{if((await controller.get()).tabId===id)await controller.stop('Attached calendar tab was closed. Reopen, log in, and attach it again.');});
// Chrome may clear alarms at restart. Never continue an interrupted observation.
async function restore() {
  const s=await controller.get();
  if(s.lease){await controller.stop('A check was interrupted. Review the calendar and resume manually.');return;}
  if(s.enabled&&!await chrome.alarms.get(ALARM))await chrome.alarms.create(ALARM,{delayInMinutes:s.recovery?Math.max(0.5,(s.recovery.dueAt-Date.now())/60000):s.cycle?0.5:s.interval||2});
}
chrome.runtime.onStartup.addListener(()=>restore().catch(console.error));
chrome.runtime.onInstalled.addListener(details=>{
  chrome.alarms.clear('visa-community').catch(console.error);
  if(details.reason==='update')return controller.stop('Extension update installed. Review the calendar and resume manually.',true).catch(console.error);
  return restore().catch(console.error);
});
