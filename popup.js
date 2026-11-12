import {slotMessage} from './slot-alerts.js';
import {deliveryLabel,desktopTestFeedback} from './popup-state.js';
const $=id=>document.getElementById(id);
let active=false;
let latestDateEdited=false;
let whatsappAlertsEdited=false;
const whatsappTypes=['slots','verification','sweep'];
$('build-version').textContent='Version '+chrome.runtime.getManifest().version;
const labels={empty:'No slots observed',available:'Dates detected',unknown:'Needs review',login:'Login needed',blocked:'Access blocked',challenge:'Verification needed',loading:'Loading incomplete',error:'Check failed'};
const time=value=>value?new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Not checked';
async function command(type,extra={}) {
  const result=await chrome.runtime.sendMessage({type,...extra});
  if(!result?.ok)throw Error(result?.error||'Extension service worker did not respond.');
  return result.state;
}
function render(s) {
  active=s.enabled;
  const slot=s.pendingSlotAlert;
  const now=Date.now();
  const recap=(s.activity||[]).filter(event=>now-event.at<12*60*60*1000);
  const total=kind=>recap.reduce((sum,event)=>sum+(event.kind===kind?event.count:0),0);
  const lastPause=recap.filter(event=>event.kind==='pause').at(-1);
  $('overnight-recap').textContent=recap.length?
    `${total('check')} successful VAC checks · ${total('match')} new matching dates · ${total('verification')} verification prompts. ${lastPause?'Last pause: '+time(lastPause.at):'No pause recorded.'}`:
    'No activity recorded in the last 12 hours.';
  const interruption=s.recovery?.stage==='human'?'Waiting for verification':s.recovery?'Calendar recovery in progress':!s.enabled?'Monitoring paused':'';
  const expectedRefreshMs=(Number(s.interval)||2)*60000+Math.max(0,(s.all===false?1:(s.locations||[]).length)-1)*30000;
  const freshnessNote=at=>interruption||(Number.isFinite(at)&&now-at>expectedRefreshMs?'Older than expected':'');
  $('slot-alert').hidden=!slot;
  if(slot){$('slot-message').textContent=slotMessage(slot.location,slot.dates);$('slot-observed').textContent='Detected '+time(slot.at)+' · '+(freshnessNote(slot.at)||'latest unacknowledged alert');}
  $('badge').textContent=slot?'Slots found':s.recovery?.stage==='human'?'Verification needed':s.recovery?'Recovering':s.enabled?'Monitoring':'Paused';$('badge').className='badge'+(slot?' slots':s.enabled?' on':'');
  if(document.activeElement!==$('slot-muted'))$('slot-muted').checked=s.slotSoundMuted===true;
  $('slot-sound-status').textContent=s.slotSoundError||'Voice alerts announce new dates and locations or ask you to complete human verification. System volume and Focus settings may affect alerts.';
  $('headline').textContent=s.recovery?'Recovering the calendar.':s.last?.status==='available'?'An opening to review.':s.enabled?'Watching for your next opening.':'Your lookout is paused.';
  $('reason').textContent=s.last?.reason||'Attach the calendar tab you logged into. You stay in control of every appointment.';
  $('last').textContent=time(s.last?.at);$('next').textContent=s.enabled&&s.nextCheck?time(s.nextCheck):'Not scheduled';
  $('attachment').textContent=s.tabId?(s.attachedAt?'Latest calendar attached · '+time(s.attachedAt):'Calendar tab attached'):'No tab attached';
  if(!latestDateEdited)$('latest-date').value=s.latestDate||'';
  $('latest-date').disabled=s.enabled;
  if(document.activeElement!==$('interval'))$('interval').value=String(s.interval||2);
  if(document.activeElement!==$('scope'))$('scope').value=s.all===false?'hyd':'all';
  if(document.activeElement!==$('notify-empty'))$('notify-empty').checked=s.notifyEmpty!==false;
  $('notify-empty').disabled=s.enabled;
  $('progress').textContent=s.recovery?`Calendar recovery · ${{human:'waiting for you to complete verification',refresh:'waiting to refresh',home:'waiting to open Home',calendar:'waiting to reopen Schedule Appointment',verify:'waiting to verify and reattach'}[s.recovery.stage]||'needs review'}. Last issue: ${s.recovery.lastError||'Calendar loading failed.'}`:s.cycle?`Sweep progress: ${s.cycle.cursor} of ${s.cycle.locations.length} locations checked${s.enabled?'':' · paused'}.`:s.lastSweep?`Last sweep: ${s.lastSweep.complete?'complete':'incomplete'} · ${time(s.lastSweep.finishedAt)}`:'No sweep started.';
  if(!whatsappAlertsEdited)for(const type of whatsappTypes)$('wa-'+type).checked=s.whatsappAlerts?.[type]!==false;
  if(document.activeElement!==$('whatsapp-enabled'))$('whatsapp-enabled').checked=s.whatsappEnabled;
  for(const id of ['whatsapp-enabled','whatsapp-number','whatsapp-save'])$(id).disabled=s.enabled;
  if(document.activeElement!==$('whatsapp-number')&&s.whatsappNumber)$('whatsapp-number').value='+'+s.whatsappNumber;
  $('whatsapp-unlock').hidden=!s.sendLock;$('whatsapp-unlock').disabled=s.enabled;
  $('whatsapp-status').textContent=s.whatsappEnabled?'Web tab attached':'Not configured';
  if(document.activeElement!==$('email-enabled'))$('email-enabled').checked=s.emailEnabled;
  if(document.activeElement!==$('email-recipient')&&s.emailRecipient)$('email-recipient').value=s.emailRecipient;
  for(const id of ['email-enabled','email-recipient','email-save','email-connect'])$(id).disabled=s.enabled;
  $('email-test').disabled=!s.emailEnabled;
  $('email-status').textContent=s.emailConnected?'Google connected':s.emailEnabled?'Enabled · connect Google':'Not configured';
  if(s.emailDelivery){
    $('email-result').textContent=s.emailDelivery.status==='sent'?`${s.emailDelivery.test?'Test':'Sweep report'} submitted ${time(s.emailDelivery.at)}. Check your inbox manually.`:`Email failed${s.emailDelivery.reason?`: ${s.emailDelivery.reason}`:''}.`;
  }
  if(s.delivery&&!(s.whatsappEnabled&&s.delivery.status==='not_configured'))$('whatsapp-result').textContent=deliveryLabel(s.delivery);
  $('start').textContent=s.enabled?'Monitoring active':'Start / resume';$('start').disabled=s.enabled;
  $('stop').disabled=!s.enabled;$('attach').disabled=s.enabled;$('interval').disabled=s.enabled;$('scope').disabled=s.enabled;
  $('permission').textContent=s.notificationPermission==='granted'?'Desktop alerts enabled in Chrome. Use Test to check macOS notification settings.':'Desktop alerts disabled. Enable Chrome notifications before monitoring.';
  const list=$('locations');list.replaceChildren();
  const locations=[...(s.locations||[])].sort((a,b)=>Number(/hyderabad/i.test(b))-Number(/hyderabad/i.test(a)));
  if(!locations.length){const p=document.createElement('p');p.className='hint';p.textContent='Attach the OFC calendar to discover locations.';list.append(p);}
  for(const name of locations){
    const observation=s.history?.[name],row=document.createElement('div');
    const freshness=observation?freshnessNote(observation.at):'';
    row.className='location'+(freshness?' stale':observation?.status==='available'?' has-slots':'');
    const top=document.createElement('div');top.className='location-top';
    const title=document.createElement('span');title.className='location-name';title.textContent=name+(/hyderabad/i.test(name)?' ★':'');
    const status=document.createElement('span');status.className='pill '+(freshness?'stale':observation?.status||'');
    const observedStatus=labels[observation?.status]||'Not checked';
    status.textContent=freshness?'Earlier result · '+observedStatus:observedStatus;top.append(title,status);
    const meta=document.createElement('div');meta.className='location-meta';meta.textContent=observation?`Last successful check ${time(observation.at)} · ${freshness||'availability may change'}`:'No successful check yet';row.append(top,meta);
    if(observation?.dates?.length){const dates=document.createElement('div');dates.className='dates';dates.textContent=observation.dates.join(' · ');row.append(dates);}
    list.append(row);
  }
}
async function refresh(){render(await command('status'));}
function action(id,run,success){$(id).addEventListener('click',async()=>{
  $('error').hidden=true;$(id).disabled=true;
  try{const result=await run();await refresh();success?.(result);}catch(e){$('error').textContent=e.message;$('error').hidden=false;if(id==='whatsapp-save')$('whatsapp-result').textContent=`Verification failed: ${e.message}`;}finally{if(id!=='start'||!active)$(id).disabled=false;}
});}
action('attach',async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw Error('Open the visa calendar tab first.');await command('attach',{tabId:tab.id});});
$('latest-date').addEventListener('input',()=>{latestDateEdited=true;});
action('start',async()=>{
  await command('start',{settings:{all:$('scope').value==='all',interval:Number($('interval').value),notifyEmpty:$('notify-empty').checked,latestDate:$('latest-date').value}});
  latestDateEdited=false;
});
action('stop',()=>command('stop'));
action('slot-open',()=>command('open'));
action('slot-ack',()=>command('slot-ack'));
for(const id of ['slot-sound-test','verification-sound-test'])action(id,()=>command(id),()=>{$('slot-sound-status').textContent='Voice playback requested. If inaudible, check your system volume.';});
$('slot-muted').addEventListener('change',async()=>{try{await command('slot-mute',{muted:$('slot-muted').checked});await refresh();}catch(e){$('error').textContent=e.message;$('error').hidden=false;}});
action('test',()=>command('test'),()=>{$('permission').textContent=desktopTestFeedback;});
action('open',()=>command('open'));
action('email-save',()=>command('email-settings',{enabled:$('email-enabled').checked,to:$('email-recipient').value.trim()}),()=>{$('email-result').textContent=$('email-enabled').checked?'Email settings saved. Connect Google to authorize send-only access.':'Email reports disabled.';});
action('email-connect',async()=>{
  if(!$('email-enabled').checked)throw Error('Enable and save email reports first.');
  await command('email-connect');$('email-result').textContent='Google connected. Send a test email to verify delivery.';
});
action('email-test',async()=>{
  await command('email-test');$('email-result').textContent='Test email submitted. Check your inbox manually; no mail was read.';
});
action('whatsapp-save',async()=>{
  if(!$('whatsapp-enabled').checked)throw Error('Turn on “Send through my WhatsApp Web session” before verifying.');
  const number=$('whatsapp-number').value.trim();
  if(!number)throw Error('Enter the recipient number with its country code.');
  $('whatsapp-result').textContent='Requesting WhatsApp Web access…';
  if(!await chrome.permissions.request({origins:['https://web.whatsapp.com/*']}))throw Error('WhatsApp Web permission was not granted.');
  $('whatsapp-result').textContent='Access is available. Verifying the recipient in the open WhatsApp tab…';
  await command('whatsapp-settings',{enabled:true,number});
  $('whatsapp-result').textContent='Recipient verified and tab attached. Send a test and confirm receipt yourself.';
});
for(const type of whatsappTypes)$('wa-'+type).addEventListener('change',()=>{whatsappAlertsEdited=true;});
action('wa-alert-save',async()=>{
  const choices=Object.fromEntries(whatsappTypes.map(type=>[type,$('wa-'+type).checked]));
  await command('whatsapp-alerts',choices);
  whatsappAlertsEdited=false;
},()=>{$('whatsapp-result').textContent='WhatsApp alert choices saved.';});
action('whatsapp-test',async()=>{await command('whatsapp-test');$('whatsapp-result').textContent='Test submitted in WhatsApp Web. Please confirm receipt; no chat history was read.';});
action('whatsapp-unlock',()=>command('whatsapp-unlock'));
refresh().catch(e=>{$('error').textContent=e.message;$('error').hidden=false;});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.watch||changes.slotSoundMuted||changes.slotSoundError))refresh().catch(console.error);});
