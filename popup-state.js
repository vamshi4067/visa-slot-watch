const knownCodes=['controls_unavailable','recipient_unverified','recipient_changed','draft','paused','wrong_page','insertion_failed','insertion_unconfirmed','draft_changed','send_control_unavailable','submission_unconfirmed','send_error','busy','interrupted_send','invalid_settings','tab_unavailable'];
export const desktopTestFeedback='Chrome accepted the test notification request. If no banner appears, check macOS System Settings > Notifications > Google Chrome and Focus.';

export function deliveryLabel(delivery){
  if(!delivery)return '';
  if(delivery.status==='filtered')return 'This WhatsApp message type is turned off.';
  if(delivery.status==='submitted')return 'Submitted in WhatsApp Web. Receipt has not been confirmed; chat history was not read.';
  if(delivery.status==='failed')return `Last WhatsApp report failed (${knownCodes.includes(delivery.reason)?delivery.reason:'unknown'}); monitoring continues. Check receipt before clearing the send lock.`;
  if(delivery.status==='not_configured')return 'WhatsApp Web sending is not enabled.';
  return 'WhatsApp status unknown.';
}
