'use strict';
const scenarios = {
  request: {title:'Your scheduled post needs approval', body:'“October Product Launch” is scheduled for October 20 at 6:00 PM on Facebook and TikTok. Review the exact content before it goes live.', action:'Review post'},
  reminder: {title:'A quick reminder. Your call.', body:'Your sample launch is scheduled in 2 hours. Approval is still pending. Without your confirmation, publication will be held.', action:'Review post'},
  held: {title:'Held. Until you say go.', body:'The scheduled time passed without approval. Nothing was published in this example. Review the post and choose a new time.', action:'Review held post'},
  receipt: {title:'Your publishing receipt is ready', body:'Illustrative outcome: Facebook reports published; TikTok is still processing. View each destination separately. Public visibility has not been independently verified.', action:'View sample receipt'}
};
const dialog = document.querySelector('#review-dialog');
const scenario = document.querySelector('#scenario');
let activeChannel = 'phone';
function resetDecision(){
  const receipt = scenario.value === 'receipt';
  document.querySelector('#review-title').textContent = receipt ? 'Your sample receipt.' : 'One last look.';
  document.querySelector('#sample-status').textContent = receipt ? 'Illustrative session approval · no cryptographic signature' : scenario.value === 'held' ? 'Held · a new schedule would require approval' : 'Awaiting approval · illustrative';
  document.querySelector('#decision-controls').hidden = receipt;
  document.querySelector('#decision-result').textContent = receipt ? 'SAMPLE ONLY: Facebook — PUBLISHED (provider-reported). TikTok — PROCESSING. No actual platform IDs, signatures, or public verification exist.' : 'Preview controls only. No real publishing action is available.';
  document.querySelector('#reset-preview').hidden = true;
}
function render(){
  const item = scenarios[scenario.value];
  document.querySelectorAll('[data-notice-title]').forEach(el=>el.textContent=item.title);
  document.querySelectorAll('[data-notice-body]').forEach(el=>el.textContent=item.body);
  document.querySelectorAll('.review-trigger').forEach(el=>{el.textContent=item.action+' ↗';});
  document.querySelector('.phone-date').textContent = ['held','reminder','receipt'].includes(scenario.value) ? 'Tuesday, October 20' : 'Monday, October 19';
  document.querySelector('.phone-clock').textContent = scenario.value === 'reminder' ? '16:00' : scenario.value === 'receipt' ? '18:01' : '18:00';
  document.querySelector('.inbox-item small').textContent = scenario.value === 'request' ? 'OCT 19 · 6:00 PM' : scenario.value === 'reminder' ? 'OCT 20 · 4:00 PM' : 'OCT 20 · 6:00 PM';
  document.querySelectorAll('[data-channel]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.channel===activeChannel)));
  document.querySelectorAll('.channel-view').forEach(el=>el.hidden=el.id!==activeChannel+'-preview');
  document.querySelector('#channel-label').textContent = {phone:'PHONE / LOCK SCREEN',email:'EMAIL / MESSAGE PREVIEW',inbox:'PXSTER / NOTIFICATION INBOX'}[activeChannel];
  resetDecision();
}
document.querySelectorAll('[data-channel]').forEach(el=>el.addEventListener('click',()=>{activeChannel=el.dataset.channel;render();}));
scenario.addEventListener('change',render);
document.querySelectorAll('.review-trigger').forEach(el=>el.addEventListener('click',()=>{resetDecision();dialog.showModal();}));
document.querySelector('#close-review').addEventListener('click',()=>dialog.close());
document.querySelectorAll('[data-decision]').forEach(el=>el.addEventListener('click',()=>{
  const states={approve:['Simulated approval only','In the proposed workflow, this would authorize the displayed revision after server verification. This preview has not approved or scheduled anything.'],revise:['Revision requested · simulated','The proposed workflow would create a new revision and require fresh approval. No content has been changed.'],reject:['Rejected · simulated','The proposed workflow would keep this revision from publishing. No real post was affected.']};
  const [status,message]=states[el.dataset.decision];
  document.querySelector('#sample-status').textContent=status;
  document.querySelector('#decision-result').textContent=message;
  document.querySelector('#decision-controls').hidden=true;
  document.querySelector('#reset-preview').hidden=false;
}));
document.querySelector('#reset-preview').addEventListener('click',resetDecision);
render();
