const GMAIL_SEND_URL='https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const encoder=new TextEncoder();

export function validEmailAddress(value){
  if(typeof value!=='string'||value!==value.trim()||/[\r\n\s]/.test(value)||value.length>254)return false;
  const match=/^([^@]+)@([^@]+)$/.exec(value);
  if(!match)return false;
  const [local,domain]=match.slice(1);
  return local.length<=64&&!local.startsWith('.')&&!local.endsWith('.')&&!local.includes('..')&&!/[<>(),;:\\"\[\]]/.test(local)&&domain.includes('.')&&domain.split('.').every(label=>/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

function bytesToBase64(bytes){
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary);
}

export function encodeRawEmail({to,subject,body}){
  if(!validEmailAddress(to))throw Error('Enter a valid recipient email address.');
  if(typeof subject!=='string'||/[\r\n]/.test(subject))throw Error('Invalid email subject.');
  const bodyBase64=bytesToBase64(encoder.encode(String(body))).replace(/.{1,76}/g,'$&\r\n').trimEnd();
  const mime=[`To: ${to}`,`Subject: ${subject}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',''+bodyBase64].join('\r\n');
  return bytesToBase64(encoder.encode(mime)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

export function createGmailSender({getToken,fetchImpl=fetch}){
  return async({to,subject,body})=>{
    if(!validEmailAddress(to))throw Error('Enter a valid recipient email address.');
    const token=await getToken();
    if(typeof token!=='string'||!token)throw Error('Google authorization is required. Connect Gmail and try again.');
    const response=await fetchImpl(GMAIL_SEND_URL,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw:encodeRawEmail({to,subject,body})})});
    if(!response.ok)throw Error(`Gmail API rejected the send (${response.status}).`);
    return {status:'sent'};
  };
}

export function formatSweepEmail(report){
  const labels={empty:'No Slots Available',available:'Dates found',not_checked:'Not checked',login:'Login required',blocked:'Access blocked',challenge:'Verification required',loading:'Loading incomplete',unknown:'Unknown',error:'Check failed'};
  const checked=report.finishedAt?new Date(report.finishedAt).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'time unavailable';
  const rows=(report.locations||[]).map(item=>{
    const result=labels[item.status]||'Unknown';
    return `- ${item.location}: ${result}${item.dates?.length?` — ${item.dates.join(', ')}`:''}`;
  });
  return [`Visa Slot Watch completed a sweep at ${checked}.`,'','Location results:',...rows,'','Notification only. Review the calendar manually; no appointment was booked.'].join('\n');
}
