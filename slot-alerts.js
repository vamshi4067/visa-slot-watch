import {validDate} from './core.js';
export const verificationSpeech='Human verification needed. Open the visa tab to continue monitoring.';

export function slotMessage(location,dates){
 const unique=[...new Set(dates)].sort();
 if(!unique.length||!unique.every(validDate))throw Error('Unrecognized appointment dates.');
 const format=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});
 const labels=unique.map(date=>format.format(new Date(date+'T00:00:00Z')));
 const list=new Intl.ListFormat('en-US',{style:'long',type:'conjunction'}).format(labels);
 return `Visa slots available on ${list}, at ${location}.`;
}
export function createAlertDelivery(io){
 return async(title,message,options={})=>{
  if(options.kind==='verification'){
   try{await io.visual(title,message,options);}
   finally{
    try{await io.sound(verificationSpeech);}catch{/* Keep the visual alert if audio fails. */}
   }
   return;
  }
  await io.visual(title,message,options);
  if(options.kind==='slots'){
   try{if(!await io.muted())await io.sound(message);}catch{/* A failed voice alert must not discard a delivered visual alert. */}
  }
 };
}
