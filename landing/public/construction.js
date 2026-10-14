(() => {
  const toggle = document.getElementById('login-toggle');
  const options = document.getElementById('login-options');
  if (!toggle || !options) return;
  const close = () => { options.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => {
    options.hidden = !options.hidden;
    toggle.setAttribute('aria-expanded', String(!options.hidden));
  });
  document.addEventListener('click', event => {
    if (!toggle.parentElement.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !options.hidden) { close(); toggle.focus(); }
  });
  toggle.parentElement.addEventListener('focusout', event => {
    if (!toggle.parentElement.contains(event.relatedTarget)) close();
  });
})();

// Small, browser-only ripple renderer. Capped at 30 fps; suspended in hidden tabs.
(() => {
  const canvas = document.querySelector('.wave-grid');
  const scene = document.querySelector('.scene');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const ctx = canvas?.getContext('2d');
  if (!ctx || !scene) return;
  let width = 0, height = 0, frame = 0, last = 0, phase = 0, cycleTime = 0;
  let mouseX = 0, mouseY = 0, driftX = 0, driftY = 0;
  let scrollTarget = window.scrollY || 0, scrollPosition = scrollTarget;
  let terrainPosition = 0;
  // Keep interaction local: no tracking, storage, or network requests.
  let ripples = [];
  const smooth = value => value * value * (3 - 2 * value);
  function advanceRipples(seconds) {
    ripples = ripples.filter(r => (r.age += seconds) < r.duration);
  }
  function sampleSwell(track, age) {
    const t = age / track.duration;
    const travel = .24 * t + .76 * t * t;
    const build = smooth(Math.max(0, Math.min((t - .2) / .48, 1)));
    const fade = 1 - smooth(Math.max(0, Math.min((t - .72) / .28, 1)));
    const origin = track.origin ?? -1.15 * track.direction;
    const depth = track.depth ?? .78;
    return {
      x: origin + ((track.targetLane ?? 1.15 * track.direction) - origin) * travel,
      depth: depth + ((track.targetDepth ?? Math.min(.09, depth * .3)) - depth) * travel,
      direction: track.direction,
      energy: smooth(Math.min(t / .1, 1)) * (.24 + .76 * build) * fade,
      amplitude: track.amplitude
    };
  }
  const saucer = document.querySelector('.ufo');
  const loginPanel = document.querySelector('.login-panel');
  const frog = document.querySelector('.space-frog');
  let firstPageUntouched = window.scrollY < 8, frogPlayed = false;
  let frogFlights = [];
  let frogUnlocked = false;
  const storyBadge = document.querySelector('.status');
  const storyCopies = [...document.querySelectorAll('[data-story]')];
  let storyAge = null, storyStarted = false;
  function paintStory(name, opacity = 1) {
    for (const copy of storyCopies) copy.style.opacity = copy.dataset.story === name ? String(opacity) : '0';
    const labels = {construction:'Under construction', pond:'An old pond...', plop:'A plop! Making waves'};
    storyBadge?.setAttribute('aria-label', labels[name]);
  }
  function advanceStory(seconds) {
    if (!storyStarted && firstPageUntouched && cycleTime >= 14.7 && !reduced.matches) {
      storyStarted = true;
      storyAge = 0;
    }
    if (storyAge === null) return;
    storyAge += seconds;
    // A 1.2s glass sweep and .8s reading pause precede the existing story.
    // Starting two seconds earlier preserves the 18.5s leap and landing cues.
    const sweep = Math.min(storyAge / 1.2, 1);
    storyBadge?.style.setProperty('--story-sheen-x', `${sweep * 440}%`);
    storyBadge?.style.setProperty('--story-sheen-opacity', String(storyAge < 1.2 ? Math.sin(sweep * Math.PI) * .75 : 0));
    if (storyAge < 2) { paintStory('construction'); return; }
    const t = storyAge - 2;
    const fade = t => smooth(Math.max(0, Math.min(t, 1)));
    if (t < .5) paintStory('construction', 1 - fade(t / .5));
    else if (t < 1.3) paintStory('pond', fade((t - .5) / .8));
    else if (t < 3.15) paintStory('pond');
    else if (t < 4.35) paintStory('pond', 1 - fade((t - 3.15) / 1.2));
    else if (t < 5.35) paintStory('plop', fade(t - 4.35));
    else if (t < 7.8) paintStory('plop');
    else if (t < 9) paintStory('plop', 1 - fade((t - 7.8) / 1.2));
    else if (t < 10) paintStory('construction', fade(t - 9));
    else { paintStory('construction'); storyAge = null; }
  }
  const frogButton = document.createElement('button');
  frogButton.type = 'button';
  frogButton.className = 'ufo-frog-trigger';
  frogButton.setAttribute('aria-label', 'Send another frog from the UFO');
  frogButton.title = 'Send another frog';
  frogButton.hidden = true;
  document.body.append(frogButton);
  function launchFrog(randomLanding = false) {
    // Bound simultaneous sprites; every accepted click starts immediately.
    if (frogFlights.length >= 6) return;
    const ship = saucer.getBoundingClientRect();
    const sprite = frog.cloneNode(true);
    sprite.hidden = false;
    sprite.style.opacity = '1';
    frog.parentElement.append(sprite);
    frogFlights.push({age:0, sprite, x:ship.left + ship.width * .5,
      y:ship.top + ship.height * .46,
      lane:randomLanding ? (Math.random() - .5) * .36 : 0,
      depth:randomLanding ? .53 + Math.random() * .25 : .67,
      duration:randomLanding ? 1.2 + Math.random() * .4 : 1.35});
  }
  frogButton.addEventListener('click', () => {
    if (!frogUnlocked || !firstPageUntouched || window.scrollY >= 8 || reduced.matches) return;
    launchFrog(true);
  });
  const cancelVisitor = event => {
    // Once revealed, UFO clicks may repeat without cancelling the idle reward.
    if (event?.target === frogButton) return;
    firstPageUntouched = false;
    for (const flight of frogFlights) flight.sprite.remove();
    frogFlights = [];
    storyAge = null;
    storyBadge?.style.setProperty('--story-sheen-opacity', '0');
    paintStory('construction');
    frogButton.hidden = true;
    if (frog) frog.hidden = true;
  };
  window.addEventListener('pointerdown', cancelVisitor, {passive:true});
  window.addEventListener('keydown', cancelVisitor);
  window.addEventListener('scroll', cancelVisitor, {passive:true});
  window.addEventListener('resize', cancelVisitor, {passive:true});
  function advanceFrog(seconds) {
    if (!frog || !saucer || reduced.matches) return;
    // The second staggered packet ends at 18.3s. Leap once in that calm gap.
    if (!frogPlayed && firstPageUntouched && window.scrollY < 8 && cycleTime >= 18.5) {
      frogPlayed = true;
      launchFrog();
    }
    const rect = canvas.getBoundingClientRect();
    frogFlights = frogFlights.filter(flight => {
      flight.age += seconds;
      const t = Math.min(flight.age / flight.duration, 1);
      const landing = point(flight.lane, flight.depth);
      const x = flight.x + (rect.left + landing[0] - flight.x) * t;
      const y = flight.y + (rect.top + landing[1] - flight.y) * t
        - Math.sin(Math.PI * t) * Math.min(100, innerHeight * .12);
      flight.sprite.style.transform = `translate(${x - 24}px,${y - 32}px) rotate(${t * 32 - 12}deg) scale(${1 - .25 * t})`;
      flight.sprite.style.opacity = String(1 - smooth(Math.max(0, (t - .88) / .12)));
      if (t < 1) return true;
      ripples.push({origin:flight.lane, depth:flight.depth, direction:1,
        targetDepth:.09, targetLane:1.15, age:0, duration:10, amplitude:31});
      if (ripples.length > 6) ripples.shift();
      flight.sprite.remove();
      frogUnlocked = true;
      return false;
    });
  }

  function alignSaucer() {
    const label = document.querySelector('#coming-line');
    const status = document.querySelector('.status');
    if (!saucer || !loginPanel || !label || !status) return;
    const mobile = innerWidth <= 600;
    const panel = loginPanel.getBoundingClientRect();
    const scroll = Math.max(0, window.scrollY);
    const arrival = Math.max(1, panel.top + scroll - innerHeight * .32);
    const progress = smooth(Math.min(scrollPosition / arrival, 1));
    saucer.style.setProperty('--ufo-tilt', `${Math.sin(cycleTime * Math.PI * 2 / 10.5) * 8 * (1 - progress)}deg`);
    saucer.style.setProperty('--beam-angle', `${Math.sin(cycleTime * Math.PI * 2 / 10.5) * 12 * (1 - progress)}deg`);
    const startWidth = mobile ? 125 : Math.min(280, Math.max(145, innerWidth * .21));
    const endWidth = mobile ? 115 : 150;
    const startX = innerWidth * .25 - startWidth * .5;
    const startY = status.getBoundingClientRect().bottom + scroll + 18;
    const endX = innerWidth / 3 - endWidth / 2;
    const endY = Math.max(24, panel.top - (mobile ? 95 : 120));
    saucer.style.width = `${startWidth + (endWidth - startWidth) * progress}px`;
    saucer.style.left = `${startX + (endX - startX) * progress}px`;
    saucer.style.top = `${startY + (endY - startY) * progress}px`;
    frogButton.hidden = !frogUnlocked || !firstPageUntouched || window.scrollY >= 8 || reduced.matches;
    if (!frogButton.hidden) {
      const ship = saucer.getBoundingClientRect();
      // Target only the hull/dome, leaving the decorative beam and grid interactive.
      Object.assign(frogButton.style, {left:`${ship.left + ship.width * .07}px`,
        top:`${ship.top + ship.height * .12}px`, width:`${ship.width * .86}px`,
        height:`${ship.height * .56}px`});
    }
  }
  function resize() {
    alignSaucer();
    const rect = canvas.getBoundingClientRect();
    width = rect.width; height = rect.height;
    const scale = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  // Opposing wave packets overlap, but reach their distant shores at different times.
  // Their positions and envelopes are independent; there is no shared calm/reset.
  const swellTracks = [
    { start: 0, duration: 11.8, direction: 1, amplitude: 31 },
    { start: 5.2, duration: 13.1, direction: -1, amplitude: 25 }
  ];
  let swells = [];
  function advanceSwells() {
    swells = swellTracks.flatMap(track => {
      const age = (cycleTime - track.start + 21) % 21;
      if (age >= track.duration) return [];
      return [sampleSwell(track, age)];
    });
    swells.push(...ripples.filter(r => r.age > .48).map(r =>
      sampleSwell({...r, duration: r.duration - .48}, r.age - .48)));
  }
  function point(lane, depth) {
    const spread = .07 + depth * 1.6;
    const x = width * .5 + lane * width * spread + driftX * depth * 35;
    const ripple = Math.sin(lane * 7 + depth * 9 - phase) * 12
      + Math.cos(lane * 4 - depth * 6 + phase * .7) * 7;
    let swell = 0;
    for (const wave of swells) {
      const across = (lane - wave.x) * wave.direction;
      const offshore = depth - wave.depth;
      const front = across * .65 - offshore * 1.3;
      const envelope = Math.exp(-((front / .24) ** 2) - (offshore / .42) ** 2);
      swell += Math.cos(front * 13) * envelope * wave.amplitude * wave.energy;
    }
    // Expanding rings live on the grid surface, so perspective compresses them
    // near the horizon. The shore-facing arc carries more height and volume.
    for (const r of ripples) {
      const along = (lane - r.origin) * .8;
      const outward = depth - r.depth;
      const distance = Math.hypot(along, outward);
      // Pull a soft pocket down first, then rebound into a narrower crest.
      // Negative swell lowers the mesh; positive swell lifts it.
      let impact = 0;
      if (r.age < .28) impact = -76 * smooth(r.age / .28);
      else if (r.age < .65) impact = -76 + 132 * smooth((r.age - .28) / .37);
      else if (r.age < 1.3) impact = 56 * (1 - smooth((r.age - .65) / .65));
      const pocketWidth = .16 - .055 * smooth(Math.min(r.age / .65, 1));
      swell += impact * Math.exp(-((distance / pocketWidth) ** 2));
      const ringAge = Math.max(0, r.age - .48);
      const radius = .065 * ringAge + .018 * ringAge * ringAge;
      const front = distance - radius;
      const shoreBias = distance > .001 ? -outward / distance : 0;
      const amplitude = 17 + 9 * shoreBias;
      const fade = 1 - smooth(Math.max(0, Math.min((ringAge - 4) / 4, 1)));
      const energy = smooth(Math.min(ringAge / .35, 1)) * fade;
      swell += Math.cos(front * 37) * Math.exp(-((front / .16) ** 2))
        * amplitude * energy;
    }
    let y = depth * depth * height * 1.1 + ripple * .16 * depth
      - swell * Math.min(depth * 2.5, 1) + driftY * depth * 8;
    return [x, y];
  }

  function centerLight(alpha) {
    const glow = ctx.createLinearGradient(0, 0, width, 0);
    glow.addColorStop(0, `rgba(255,38,190,${alpha * .45})`);
    glow.addColorStop(.25, `rgba(0,200,235,${alpha * .45})`);
    glow.addColorStop(.5, `rgba(90,250,255,${Math.min(alpha * 2.2, .95)})`);
    glow.addColorStop(.75, `rgba(0,200,235,${alpha * .45})`);
    glow.addColorStop(1, `rgba(255,38,190,${alpha * .45})`);
    return glow;
  }
  function line(points, color) {
    ctx.beginPath();
    points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.strokeStyle = color; ctx.stroke();
  }
  function draw(timestamp) {
    if (document.hidden || reduced.matches) { frame = 0; return; }
    frame = requestAnimationFrame(draw);
    if (timestamp - last < 1000 / 30) return;
    const elapsed = last ? Math.min(timestamp - last, 100) : 0;
    last = timestamp;
    cycleTime = (cycleTime + elapsed / 1000) % 21;
    phase += elapsed / 1000 * .35;
    advanceRipples(elapsed / 1000);
    advanceSwells();
    driftX += (mouseX - driftX) * .07; driftY += (mouseY - driftY) * .07;
    scrollPosition += (scrollTarget - scrollPosition) * .12;
    alignSaucer();
    advanceStory(elapsed / 1000);
    advanceFrog(elapsed / 1000);
    scene.style.setProperty('--scene-scroll', `${scrollPosition.toFixed(2)}px`);
    // Keep the shoreline joined while the whole terrain drifts only a few pixels.
    const terrainTarget = -24 * Math.tanh(Math.max(0, scrollTarget) / 1000);
    terrainPosition += (terrainTarget - terrainPosition) * (1 - Math.exp(-elapsed / 280));
    scene.style.setProperty('--terrain-scroll', `${terrainPosition.toFixed(2)}px`);
    ctx.clearRect(0, 0, width, height); ctx.lineWidth = 1;
    const meshLight = centerLight(.4);
    for (let row = 1; row <= 23; row++) {
      const d = row / 23;
      line(Array.from({length:81}, (_,i) => point((i / 80 - .5) * 3, d)), meshLight);
    }
    for (let column = -18; column <= 18; column++) {
      line(Array.from({length:45}, (_,i) => point(column / 12, i / 44)), meshLight);
    }
  }
  function sync() {
    if (reduced.matches || document.hidden) { ripples = []; cancelVisitor(); }
    cancelAnimationFrame(frame); frame = 0; last = 0;
    scene.classList.toggle('wave-ready', !reduced.matches);
    if (!reduced.matches && !document.hidden) { resize(); frame = requestAnimationFrame(draw); }
  }
  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || reduced.matches) return;
    mouseX = e.clientX / innerWidth - .5; mouseY = e.clientY / innerHeight - .5;
  }, {passive:true});
  window.addEventListener('pointerdown', event => {
    if (reduced.matches || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.target.closest?.('a, button, input, select, textarea, [role="button"]')) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    // Pick the visible surface, including its current swell and mouse drift.
    // Store grid coordinates so the wave shares the automatic waves' perspective.
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    let origin = 0, depth = .5, nearest = Infinity;
    for (let step = 0; step <= 180; step++) {
      const d = step / 180;
      const lane = (px - width * .5 - driftX * d * 35) / (width * (.07 + d * 1.6));
      const distance = Math.abs(point(lane, d)[1] - py);
      if (distance < nearest) { nearest = distance; origin = lane; depth = d; }
    }
    // Lower-half presses travel out toward the viewer; upper presses head inland.
    const foreground = py > rect.height * .5;
    const direction = origin <= 0 ? 1 : -1;
    ripples.push({ origin, depth, direction,
      targetDepth: foreground ? 1.35 : Math.min(.09, depth * .3),
      targetLane: foreground ? origin * .65 : 1.15 * direction,
      age: 0, duration: 10, amplitude: foreground ? 14 : 31 });
    if (ripples.length > 4) ripples.shift();
  }, {passive:true});
  const reset = () => { mouseX = mouseY = 0; };
  document.documentElement.addEventListener('pointerleave', reset);
  window.addEventListener('blur', reset);
  window.addEventListener('scroll', () => { scrollTarget = window.scrollY; }, {passive:true});
  window.addEventListener('resize', resize, {passive:true});
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  alignSaucer();
  document.fonts?.ready.then(alignSaucer);
  sync();
})();
