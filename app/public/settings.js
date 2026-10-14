(() => {
  const form = document.querySelector('#approval-settings-preview');
  const byId = id => document.getElementById(id);
  const format = date => new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(date);
  function timeline(){
    const when = new Date(byId('approval-sample-time').value + ':00+08:00');
    const output = byId('approval-timeline');
    if (Number.isNaN(when.getTime())) { output.textContent='Choose a sample publication time.'; return; }
    const lead = Number(byId('approval-lead').value);
    const reminder = Number(byId('approval-reminder').value);
    output.textContent = `Sample request: ${format(new Date(when - lead*3600000))}. Publication: ${format(when)}. ` + (reminder ? `Reminder: ${format(new Date(when - reminder*3600000))}, only if pending. ` : 'No follow-up reminder. ') + `Missing approval: ${byId('approval-missing').value === 'hold' ? 'hold publication' : 'expire attempt'}. Asia/Manila. ` + (reminder && reminder >= lead ? 'The reminder must be later than the initial request; change the preview timing.' : '');
  }
  function notification(){
    const channel = byId('settings-preview-channel').value;
    const event = byId('settings-preview-event').value;
    const samples = {
      request:['Your scheduled post needs approval','“October Product Launch” is scheduled for October 20 at 6:00 PM on Facebook and TikTok. Review the exact content before it goes live.'],
      reminder:['Your post is waiting for your call','Two hours to the sample publication time. Approval is pending. Without confirmation, the proposed workflow holds publication.'],
      held:['Held. Until you say go.','The sample scheduled time passed without approval. Review the post and choose a new publishing time.'],
      receipt:['Your sample receipt is ready','Illustrative result: Facebook reports published; TikTok is processing. Public visibility is not independently verified. No real post or signature exists.']
    };
    byId('settings-preview-label').textContent = `${channel.toUpperCase()} · SAMPLE ONLY`;
    byId('settings-notification').dataset.channel=channel;
    byId('settings-preview-title').textContent=samples[event][0];
    byId('settings-preview-body').textContent=samples[event][1];
    byId('settings-preview-review').textContent=event==='receipt'?'Review sample receipt →':'Review sample →';
    byId('settings-sample-review').hidden=true;
    document.querySelectorAll('[data-settings-decision]').forEach(el=>el.hidden=event==='receipt');
    byId('settings-decision-result').textContent=event==='receipt'?'Illustrative only: no platform IDs, cryptographic signatures, or independent verification exist.':'No real authorization exists for this example.';
  }
  form.addEventListener('submit',event=>event.preventDefault());
  form.addEventListener('change', event=>{
    if(event.target.id==='approval-mode'){
      const strict=event.target.value==='strict';
      byId('approval-people').value=strict?'two':'owner';
      byId('approval-people').disabled=strict;
    }
    timeline();
    if(event.target.id.startsWith('settings-preview-')) notification();
  });
  form.addEventListener('reset',()=>setTimeout(()=>{byId('approval-people').disabled=false;timeline();notification();},0));
  byId('logout').addEventListener('click',()=>form.reset());
  byId('settings-preview-review').addEventListener('click',()=>{const review=byId('settings-sample-review');review.hidden=false;review.open=true;review.scrollIntoView({block:'nearest'});});
  document.querySelectorAll('[data-settings-decision]').forEach(button=>button.addEventListener('click',()=>{byId('settings-decision-result').textContent={approve:'Simulated approval only. No post was authorized or scheduled.',revise:'Simulated revision request. A real change would invalidate the previous approval.',reject:'Simulated rejection. No real publishing record was affected.'}[button.dataset.settingsDecision];}));
  document.querySelectorAll('[data-settings-scroll]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();byId(link.dataset.settingsScroll).scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}));
  timeline();notification();
})();
