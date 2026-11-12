export async function speakAlert(tts,text){
 const voices=await tts.getVoices();
 const voice=voices.find(voice=>voice.voiceName&&!voice.remote&&!voice.extensionId&&/^en(?:-|$)/i.test(voice.lang));
 if(!voice)throw Error('No local English voice is available in Chrome.');
 await tts.speak(text,{voiceName:voice.voiceName,lang:voice.lang,enqueue:true});
}
