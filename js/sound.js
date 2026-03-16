/**
 * sound.js — Lightweight sound layer using the Web Audio API.
 *
 * Keeps all audio logic in one place so the rest of the game
 * just calls semantic helpers like Sound.flipper(), Sound.bump(), etc.
 *
 * This is intentionally simple, inspired by small Web Audio helpers
 * like ZzFX, but written in a clear, readable way rather than golfed.
 */

const Sound = (() => {
  // Lazily-created AudioContext so we don't trip autoplay policies
  // until the player actually presses a key.
  let ctx = null;
  let masterGain = null;
  let muted = false;

  function ensureContext() {
    if (ctx || muted) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      // Older browsers: fail silently, the game still plays.
      muted = true;
      return;
    }
    ctx = new AudioCtx();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(ctx.destination);
  }

  /**
   * Play a very short \"chip\" sound.
   *
   * @param {object} opts
   * @param {number} opts.freq     - base frequency in Hz
   * @param {number} opts.duration - duration in seconds
   * @param {string} opts.type     - oscillator type: 'sine' | 'square' | 'triangle' | 'sawtooth'
   * @param {number} opts.volume   - relative volume 0–1
   * @param {number} opts.pitchJitter - random detune amount in semitones
   */
  function blip({
    freq,
    duration = 0.08,
    type = "square",
    volume = 1,
    pitchJitter = 0,
  }) {
    if (muted) return;
    ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Optional small random pitch variation so repeated hits don't sound identical.
    const jitter =
      pitchJitter !== 0 ? Math.pow(2, (Math.random() * pitchJitter) / 12) : 1;

    osc.type = type;
    osc.frequency.value = freq * jitter;

    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(masterGain);

    const now = ctx.currentTime;

    // Simple decay envelope.
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  const api = {
    /** Toggle mute on/off. */
    toggleMute() {
      muted = !muted;
    },

    /** Whether sound is currently muted. */
    isMuted() {
      return muted;
    },

    /** Short mechanical click for flipper presses. */
    flipper() {
      blip({ freq: 900, duration: 0.05, type: "square", volume: 0.7, pitchJitter: 2 });
    },

    /** Thunk for bumper hits. */
    bumper() {
      blip({ freq: 260, duration: 0.12, type: "triangle", volume: 0.8, pitchJitter: 4 });
    },

    /** Brighter chime for hoop scores. */
    hoop() {
      blip({ freq: 880, duration: 0.14, type: "sine", volume: 0.8, pitchJitter: 3 });
    },

    /** Metallic hit for ramp scoops. */
    ramp() {
      blip({ freq: 520, duration: 0.12, type: "square", volume: 0.9, pitchJitter: 3 });
    },

    /** Low \"drain\" thud when ball is lost. */
    drain() {
      blip({ freq: 120, duration: 0.18, type: "triangle", volume: 0.9, pitchJitter: 1 });
    },

    /** Launch sound when plunger fires. */
    launch() {
      blip({ freq: 340, duration: 0.16, type: "sawtooth", volume: 0.8, pitchJitter: 2 });
    },

    /** Extra bright chord-like hit when On Fire starts. */
    onFireStart() {
      blip({ freq: 1100, duration: 0.18, type: "square", volume: 1.0, pitchJitter: 6 });
    },

    /** Slingshot kick sound. */
    slingshot() {
      blip({ freq: 420, duration: 0.09, type: "square", volume: 0.85, pitchJitter: 4 });
    },
  };

  return api;
})();

