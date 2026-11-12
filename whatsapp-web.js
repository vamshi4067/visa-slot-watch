const MAIN='#main';
const PANELS='[data-testid="contact-info-drawer"],[data-testid="chat-info-drawer"],[role="dialog"][aria-label="Contact info"],[role="complementary"][aria-label="Contact info"]';
const digits=value=>String(value||'').replace(/\D/g,'');
export function textLength(node){
  // Count draft metadata only; never read textContent, innerText or text values.
  let size=0;for(const child of node?.childNodes||[])size+=child.nodeType===3?child.length:textLength(child);return size;
}
function visible(el){return !!el&&!el.closest('[hidden],[aria-hidden="true"]')&&(typeof el.getClientRects!=='function'||el.getClientRects().length>0);}
const phoneValue=value=>typeof value==='string'&&/^\+?[\d\s().-]{8,25}$/.test(value)?digits(value):'';
const identityFor=header=>header?.querySelector('[data-testid="conversation-info-header-chat-title"],span[title][dir="auto"]');
function headerPhoneMatches(doc,number){const el=identityFor(doc.querySelector(MAIN+' header'));return !!el&&visible(el)&&phoneValue(el.getAttribute('title'))===number;}
function emptyComposer(el){return textLength(el)===0&&[...el.querySelectorAll('*')].every(n=>['P','DIV','BR'].includes(n.tagName));}
function panelScopes(doc){
  const panels=[...doc.querySelectorAll(PANELS)];
  for(const drawer of doc.querySelectorAll('[data-animate-drawer-body="true"]')){
    const header=drawer.querySelector('header')||drawer.parentElement?.querySelector(':scope > header');
    // Read the drawer's control heading only, never the drawer body or chat history.
    if(header&&[...header.querySelectorAll('h1,h2,[role="heading"],span')].some(el=>el.textContent?.trim()==='Contact info'))panels.push(drawer);
  }
  return panels;
}
export function recipientMatches(doc,number,isVisible=visible){
  if(!/^[1-9]\d{7,14}$/.test(number))return false;
  const header=doc.querySelector(MAIN+' header');
  const identity=identityFor(header);
  if(identity&&isVisible(identity)&&phoneValue(identity.getAttribute('title'))===number)return true;
  for(const panel of panelScopes(doc)){
    if(!isVisible(panel))continue;
    const phoneLabel=panel.querySelector('[data-testid="section-phone-number"]');
    const phoneValueNode=phoneLabel?.parentElement?.children.length===2?phoneLabel.nextElementSibling:null;
    if(phoneValueNode&&isVisible(phoneValueNode)&&digits(phoneValueNode.textContent)===number)return true;
    for(const link of panel.querySelectorAll('a[href^="tel:"]'))if(isVisible(link)&&phoneValue(link.getAttribute('href').slice(4))===number)return true;
    for(const field of panel.querySelectorAll('[data-testid="contact-info-phone"],[aria-label="Phone number"],input[type="tel"]')){
      const value=field.value||field.getAttribute('title')||field.textContent;
      if(isVisible(field)&&phoneValue(value)===number)return true;
    }
  }
  return false;
}
function composerFor(doc){return doc.querySelector(MAIN+' footer [contenteditable="true"][role="textbox"]');}
export function inspectControls(doc,number,isVisible=visible){
  const composer=composerFor(doc);
  if(!composer||!isVisible(composer))return {status:'controls_unavailable',recipientMatched:false};
  if(!emptyComposer(composer))return {status:'draft',recipientMatched:false};
  const matched=recipientMatches(doc,number,isVisible);
  return {status:matched?'ready':'recipient_unverified',recipientMatched:matched};
}
export function formatWebReport(report){
  if(report.type==='slots'){
    const earliest=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(report.earliestDate+'T00:00:00Z'));
    const checked=new Date(report.finishedAt).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'});
    return `Visa Slot Watch | New matching availability | ${report.location} | Earliest: ${earliest} | Matching dates: ${report.matchingCount} | Checked: ${checked}`;
  }
  if(report.type==='verification')return 'Visa Slot Watch: Human verification needed. Open the visa portal tab on your Mac and complete the check. Monitoring will resume after verification clears if the session is still waiting.';
  if(report.type==='test')return 'Visa Slot Watch TEST: WhatsApp notifications are being set up. This test did not check appointment availability. No appointment was booked.';
  const labels={empty:'No Slots Available',available:'Dates detected',not_checked:'Not checked',login:'Login required',blocked:'Access blocked',challenge:'Verification required',loading:'Loading incomplete',unknown:'Unknown',error:'Check failed'};
  const results=report.locations.map(r=>`${r.location}: ${labels[r.status]||'Unknown'}${r.dates?.length?' '+r.dates.join(', '):''}`).join('; ');
  const text=`Visa Slot Watch | ${new Date(report.finishedAt).toLocaleString()} | ${report.complete?'All listed VACs checked':'INCOMPLETE sweep; unvisited locations were not checked'} | ${results} | Rendered calendar only. Review manually; no appointment booked.`.replace(/\s+/g,' ');
  if(text.length>4000)throw Error('Report is too long; no WhatsApp message was sent.');
  return text;
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export async function runWebSender(request){
  if(location.origin!=='https://web.whatsapp.com')return {status:'wrong_page'};
  const check=()=>inspectControls(document,request.number);
  let state=check();
  const main=document.querySelector(MAIN),header=main?.querySelector('header'),identity=identityFor(header),identityTitle=identity?.getAttribute('title'),identityLabel=identity?.getAttribute('aria-label'),composer=composerFor(document);
  if(!identity||!composer)return {status:'controls_unavailable'};
  let identityChanged=false;
  const identityObserver=new MutationObserver(()=>{identityChanged=true;});
  identityObserver.observe(identity,{attributes:true,childList:true,characterData:true,subtree:true});
  const sameRecipient=()=>!identityChanged&&document.querySelector(MAIN)===main&&main.querySelector('header')===header&&identityFor(header)===identity&&identity.getAttribute('title')===identityTitle&&identity.getAttribute('aria-label')===identityLabel&&composerFor(document)===composer;
  const finish=result=>{identityObserver.disconnect();return result;};
  if(['ready','recipient_unverified'].includes(state.status)&&!headerPhoneMatches(document,request.number)){
    for(const panel of panelScopes(document).filter(visible)){
      const close=panel.querySelector('button[aria-label="Close"],[role="button"][aria-label="Close"]');
      if(!close)return finish({status:'recipient_unverified'});
      close.click();
    }
    const closedBy=Date.now()+1500;while(panelScopes(document).some(visible)&&Date.now()<closedBy){await wait(100);if(!sameRecipient())return finish({status:'recipient_changed'});}
    if(panelScopes(document).some(visible))return finish({status:'recipient_unverified'});
    const button=header?.querySelector('[aria-label="Profile details"],[aria-label="Contact info"],[data-testid="conversation-info-header-chat-title"]');
    if(!button)return finish(state);
    button.click();
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){await wait(250);if(!sameRecipient())return finish({status:'recipient_changed'});state=check();if(state.status==='ready')break;}
  }
  if(!sameRecipient())return finish({status:'recipient_changed'});
  if(request.mode==='verify'||state.status!=='ready')return finish(state);
  if(request.mode!=='send'||typeof request.text!=='string'||!request.text.startsWith('Visa Slot Watch')||request.text.length>4000)return finish({status:'invalid_request'});
  const guard=async()=>{
    const {watch,whatsapp}=await chrome.storage.local.get(['watch','whatsapp']);
    if(!whatsapp?.enabled||whatsapp.number!==request.number||whatsapp.tabId!==request.tabId)return false;
    return request.generation===undefined||watch?.generation===request.generation&&(watch.enabled||request.allowPaused);
  };
  const initiallyAllowed=await guard();
  if(!sameRecipient())return finish({status:'recipient_changed'});
  if(!initiallyAllowed||check().status!=='ready')return finish({status:'paused'});
  composer.focus();
  if(!document.execCommand('insertText',false,request.text))return finish({status:'insertion_failed'});
  const findSend=()=>document.querySelector(MAIN+' footer button[aria-label="Send"],'+MAIN+' footer [role="button"][aria-label="Send"]');
  let userEdited=false;
  const onInput=event=>{if(event.isTrusted)userEdited=true;};
  composer.addEventListener('beforeinput',onInput);
  try{
    const renderDeadline=Date.now()+1500;
    while(textLength(composer)!==request.text.length||!visible(findSend())){
      if(!sameRecipient())return finish({status:'recipient_changed'});
      if(userEdited)return finish({status:'draft_changed'});
      if(Date.now()>=renderDeadline){
        return finish({status:textLength(composer)===request.text.length?'send_control_unavailable':'insertion_unconfirmed'});
      }
      await wait(50);
    }
  }finally{
    composer.removeEventListener('beforeinput',onInput);
  }
  if(userEdited)return finish({status:'draft_changed'});
  let changed=false;const observer=new MutationObserver(()=>{changed=true;});observer.observe(composer,{subtree:true,childList:true,characterData:true,attributes:true});
  const allowed=await guard();changed=changed||observer.takeRecords().length>0;observer.disconnect();
  if(changed||textLength(composer)!==request.text.length)return finish({status:'draft_changed'});
  if(!allowed||!sameRecipient()||!recipientMatches(document,request.number))return finish({status:'paused_with_unsent_draft'});
  const send=findSend();
  if(!send||!visible(send))return finish({status:'send_control_unavailable'});
  send.click();
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){await wait(250);if(composer.isConnected&&textLength(composer)===0)return finish({status:'submitted'});}
  return finish({status:'submission_unconfirmed'});
}
