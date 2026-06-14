let engine;

export function getPixelAudioEngine() {
  engine ||= createPixelAudioEngine();
  return engine;
}

function createPixelAudioEngine() {
  let context = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let delay = null;
  let feedback = null;
  let filter = null;
  let sequencer = null;
  let stepIndex = 0;
  let lastStepAt = 0;
  let running = false;

  function ensureContext() {
    if (context) return context;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;

    context = new AudioContext();
    master = context.createGain();
    musicGain = context.createGain();
    sfxGain = context.createGain();
    delay = context.createDelay(1.2);
    feedback = context.createGain();
    filter = context.createBiquadFilter();

    master.gain.value = 0.42;
    musicGain.gain.value = 0.22;
    sfxGain.gain.value = 0.55;
    delay.delayTime.value = 0.34;
    feedback.gain.value = 0.22;
    filter.type = "lowpass";
    filter.frequency.value = 1850;
    filter.Q.value = 0.8;

    musicGain.connect(filter);
    filter.connect(delay);
    filter.connect(master);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(master);
    sfxGain.connect(master);
    master.connect(context.destination);

    return context;
  }

  async function start() {
    const ctx = ensureContext();
    if (!ctx) return false;
    if (ctx.state === "suspended") await ctx.resume();
    if (running) return true;

    running = true;
    scheduleChord();
    sequencer = window.setInterval(scheduleChord, 1900);
    return true;
  }

  function stop() {
    running = false;
    if (sequencer) window.clearInterval(sequencer);
    sequencer = null;
    if (master && context) {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(0.0001, context.currentTime, 0.08);
    }
  }

  function scheduleChord() {
    if (!context || !running) return;
    const now = context.currentTime;
    master.gain.setTargetAtTime(0.42, now, 0.2);

    const roots = [110, 130.81, 146.83, 164.81, 196, 174.61];
    const root = roots[stepIndex % roots.length];
    const upper = root * [1.5, 2, 2.25, 1.75][stepIndex % 4];

    pad(root, now, 1.75, 0.055);
    pad(root * 2, now + 0.04, 1.45, 0.026);
    sparkle(upper, now + 0.52, 0.34);
    if (stepIndex % 2 === 0) sparkle(upper * 1.5, now + 1.08, 0.22);

    stepIndex += 1;
  }

  function pad(frequency, when, duration, volume) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(frequency, when);
    osc.detune.setValueAtTime(softRandom(stepIndex, frequency) * 5, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain);
    gain.connect(musicGain);
    osc.start(when);
    osc.stop(when + duration + 0.05);
  }

  function sparkle(frequency, when, duration) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(frequency, when);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.996, when + duration);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.045, when + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain);
    gain.connect(musicGain);
    osc.start(when);
    osc.stop(when + duration + 0.03);
  }

  function playStep() {
    const ctx = ensureContext();
    if (!ctx || ctx.state !== "running") return;
    const nowMs = performance.now();
    if (nowMs - lastStepAt < 130) return;
    lastStepAt = nowMs;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const stepFilter = ctx.createBiquadFilter();
    const pitch = stepIndex % 2 === 0 ? 92 : 108;

    osc.type = "square";
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.62, now + 0.055);
    stepFilter.type = "lowpass";
    stepFilter.frequency.setValueAtTime(520, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

    osc.connect(stepFilter);
    stepFilter.connect(gain);
    gain.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  return {
    start,
    stop,
    playStep,
    get running() {
      return running;
    }
  };
}

function softRandom(a, b) {
  const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return n - Math.floor(n) - 0.5;
}
