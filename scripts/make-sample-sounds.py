"""Synthesizes every clip in the sound pack catalog and writes catalog/index.json.

All sounds are generated here from scratch (oscillators, noise, envelopes), so they are original,
released under CC0-1.0, and safe to ship. Run: python scripts/make-sample-sounds.py
"""
import json
import math
import os
import random
import struct
import wave

ROOT = os.path.join(os.path.dirname(__file__), '..', 'catalog')
RATE = 22050
BASE_URL = 'https://raw.githubusercontent.com/qPublic/vocalforge/main/catalog/sounds/'
TAU = 2 * math.pi


# ---------- building blocks ----------
def n(sec):
    return int(RATE * sec)


def silence(sec):
    return [0.0] * n(sec)


def shape_wave(phase, shape):
    p = (phase / TAU) % 1.0
    if shape == 'sine':
        return math.sin(phase)
    if shape == 'square':
        return 1.0 if p < 0.5 else -1.0
    if shape == 'saw':
        return 2 * p - 1
    if shape == 'tri':
        return 4 * abs(p - 0.5) - 1
    raise ValueError(shape)


def osc(freq, sec, shape='sine'):
    """Oscillator. `freq` is a number (Hz) or a function of time t (seconds)."""
    out, phase = [], 0.0
    for i in range(n(sec)):
        f = freq(i / RATE) if callable(freq) else freq
        phase += TAU * f / RATE
        out.append(shape_wave(phase, shape))
    return out


def sweep(f0, f1, sec, shape='sine', curve='exp'):
    if curve == 'exp':
        return osc(lambda t: f0 * (f1 / f0) ** (t / sec), sec, shape)
    return osc(lambda t: f0 + (f1 - f0) * (t / sec), sec, shape)


def noise(sec, seed=1):
    r = random.Random(seed)
    return [r.uniform(-1, 1) for _ in range(n(sec))]


def lowpass(sig, cutoff):
    a = 1 - math.exp(-TAU * cutoff / RATE)
    out, y = [], 0.0
    for x in sig:
        y += a * (x - y)
        out.append(y)
    return out


def highpass(sig, cutoff):
    lp = lowpass(sig, cutoff)
    return [x - l for x, l in zip(sig, lp)]


def bandpass(sig, lo, hi):
    return lowpass(highpass(sig, lo), hi)


def decay(sig, rate, attack=0.002):
    """Exponential decay with a short attack ramp (rate is 1/seconds)."""
    out = []
    for i, x in enumerate(sig):
        t = i / RATE
        a = min(1.0, t / attack) if attack else 1.0
        out.append(x * a * math.exp(-rate * t))
    return out


def fade(sig, fade_in=0.005, fade_out=0.02):
    out, total = [], len(sig)
    fi, fo = max(1, n(fade_in)), max(1, n(fade_out))
    for i, x in enumerate(sig):
        g = min(1.0, i / fi, (total - i) / fo)
        out.append(x * max(0.0, g))
    return out


def ramp(sig, start, end):
    total = max(1, len(sig) - 1)
    return [x * (start + (end - start) * i / total) for i, x in enumerate(sig)]


def mix(*sigs):
    length = max(len(s) for s in sigs)
    out = [0.0] * length
    for s in sigs:
        for i, x in enumerate(s):
            out[i] += x
    return out


def gain(sig, g):
    return [x * g for x in sig]


def cat(*sigs):
    out = []
    for s in sigs:
        out.extend(s)
    return out


def at(sig, delay_sec, length_sec):
    """Place a sound `delay_sec` into a buffer of `length_sec`."""
    out = silence(length_sec)
    start = n(delay_sec)
    for i, x in enumerate(sig):
        if start + i < len(out):
            out[start + i] += x
    return out


def note(freq, sec, shape='sine', rate=0.0, attack=0.004):
    return decay(osc(freq, sec, shape), rate, attack) if rate else fade(osc(freq, sec, shape), attack, 0.02)


def write_wav(path, sig, peak=0.8):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    top = max(1e-9, max(abs(x) for x in sig))
    data = b''.join(struct.pack('<h', int(32767 * peak * x / top)) for x in sig)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data)


# ---------- drums reused by several clips ----------
def kick():
    return decay(sweep(150, 45, 0.4), 9)


def snare(seed=3):
    body = decay(osc(190, 0.3), 25)
    rattle = decay(highpass(noise(0.3, seed), 1500), 18)
    return mix(gain(body, 0.7), rattle)


def cymbal(sec=1.2, seed=5):
    return decay(highpass(noise(sec, seed), 5000), 4)


# ---------- the clips ----------
def starter():
    clips = {}
    t = n(1.2)
    clips['ding'] = [
        (math.sin(TAU * 880 * i / RATE) + 0.5 * math.sin(TAU * 1760 * i / RATE) + 0.25 * math.sin(TAU * 2640 * i / RATE)) * math.exp(-4 * i / RATE)
        for i in range(t)
    ]
    clips['buzzer'] = fade(osc(140, 0.7, 'square'))
    clips['coin'] = cat(note(988, 0.08, 'square'), note(1319, 0.45, 'square', rate=5))
    clips['sad-descent'] = cat(note(392, 0.35), note(370, 0.35), note(349, 0.35), note(311, 0.9, rate=2.5))
    r = random.Random(7)
    lp, w, total = 0.0, [], n(1.0)
    for i in range(total):
        x = i / total
        lp += (0.02 + 0.5 * math.sin(math.pi * x) ** 2) * (r.uniform(-1, 1) - lp)
        w.append(lp * math.sin(math.pi * x) ** 1.5)
    clips['whoosh'] = w
    clips['level-up'] = cat(note(523, 0.12), note(659, 0.12), note(784, 0.12), note(1047, 0.6, rate=3))
    return clips


def retro():
    c = {}
    c['retro-jump'] = ramp(sweep(220, 880, 0.25, 'square', 'lin'), 1, 0)
    c['retro-powerup'] = cat(*[note(f, 0.06, 'square') for f in (262, 330, 392, 523, 659, 784)], note(1047, 0.25, 'square', rate=6))
    c['retro-laser'] = decay(sweep(1800, 200, 0.3, 'saw'), 4)
    c['retro-explosion'] = decay(lowpass(noise(0.9, 11), 1200), 4)
    c['retro-hit'] = mix(decay(highpass(noise(0.12, 4), 1500), 30), gain(decay(osc(120, 0.12, 'square'), 25), 0.5))
    c['retro-blip'] = fade(osc(880, 0.06, 'square'), 0.002, 0.01)
    c['retro-gameover'] = cat(note(392, 0.22, 'square'), note(330, 0.22, 'square'), note(262, 0.22, 'square'), note(196, 0.7, 'square', rate=3))
    return c


def alerts():
    c = {}
    c['alert-chime'] = decay(mix(osc(1046, 1.0), gain(osc(1568, 1.0), 0.6)), 3)
    c['alert-notify'] = cat(note(784, 0.12, rate=14), note(1175, 0.3, rate=9))
    c['alert-success'] = cat(*[note(f, 0.1, rate=8) for f in (523, 659, 784)], note(1047, 0.6, rate=4))
    c['alert-error'] = cat(lowpass(note(220, 0.16, 'square'), 900), lowpass(note(165, 0.3, 'square', rate=4), 900))
    c['alert-subscribe'] = cat(*[note(f, 0.08, rate=9) for f in (523, 659, 784, 1047)], mix(note(1319, 0.7, rate=4), gain(note(1568, 0.7, rate=5), 0.5), gain(note(2093, 0.7, rate=7), 0.3)))
    c['alert-donation'] = mix(decay(highpass(noise(0.05, 2), 3000), 60), at(decay(osc(2093, 0.9), 5), 0.04, 0.95), at(decay(osc(2637, 0.9), 5), 0.1, 0.95))
    c['alert-airy-bell'] = mix(
        [x * min(1.0, i / n(0.06)) for i, x in enumerate(decay(osc(1318, 1.6), 2.2, attack=0))],
        gain(decay(osc(1318 * 3.5, 1.6), 3.5), 0.3),
    )
    return c


def cartoon():
    c = {}
    c['toon-boing'] = decay(osc(lambda t: 180 + 520 * math.exp(-5 * t) + 70 * math.sin(TAU * 13 * t) * math.exp(-3 * t), 0.8), 3)
    c['toon-slide-up'] = fade(sweep(200, 1600, 0.6, 'sine', 'lin'), 0.01, 0.05)
    c['toon-slide-down'] = fade(sweep(1600, 200, 0.6, 'sine', 'lin'), 0.01, 0.05)
    c['toon-bonk'] = mix(decay(sweep(260, 90, 0.25), 14), gain(decay(highpass(noise(0.05, 8), 800), 80), 0.5))
    c['toon-squeak'] = fade(osc(lambda t: 1900 + 700 * t / 0.16 + 90 * math.sin(TAU * 28 * t), 0.16, 'tri'), 0.003, 0.03)
    c['toon-pop'] = decay(sweep(900, 200, 0.1), 40, attack=0.001)
    wah = lambda f, s, w: lowpass(fade(osc(f, s, 'saw'), 0.01, 0.04), w)
    c['toon-wah-wah'] = cat(wah(311, 0.4, 1100), wah(294, 0.4, 1000), wah(277, 0.4, 900), ramp(lowpass(osc(lambda t: 262 - 10 * math.sin(TAU * 6 * t), 1.0, 'saw'), 700), 1, 0.2))
    c['toon-rimshot'] = mix(at(snare(1), 0.0, 1.4), at(snare(2), 0.22, 1.4), at(gain(cymbal(1.0, 6), 0.7), 0.5, 1.4), at(kick(), 0.5, 1.4))
    scratch = osc(lambda t: 2500 * math.exp(-6 * t) + 150, 0.4, 'saw')
    c['toon-record-scratch'] = fade(mix(gain(scratch, 0.6), gain(bandpass(noise(0.4, 9), 600, 6000), 0.7)), 0.002, 0.05)
    return c


def drums():
    c = {}
    c['drum-kick'] = kick()
    c['drum-snare'] = snare()
    c['drum-hihat'] = decay(highpass(noise(0.12, 21), 7000), 55)
    clap = silence(0.35)
    for k, off in enumerate((0.0, 0.012, 0.026)):
        burst = decay(bandpass(noise(0.2, 30 + k), 900, 4500), 45)
        clap = mix(clap, at(burst, off, 0.35))
    clap = mix(clap, at(decay(bandpass(noise(0.3, 40), 900, 4500), 14), 0.03, 0.35))
    c['drum-clap'] = clap
    c['drum-tom'] = decay(sweep(220, 110, 0.5), 8)
    c['drum-cymbal'] = cymbal(1.5)
    c['drum-cowbell'] = decay(bandpass(mix(osc(587, 0.4, 'square'), osc(845, 0.4, 'square')), 500, 3000), 12)
    return c


def drama():
    c = {}
    horn = mix(*[gain(osc(lambda t, f=f: f * (1 + 0.004 * math.sin(TAU * 6 * t)), 1.2, 'saw'), 1.0) for f in (392, 494, 587, 784)])
    c['drama-airhorn'] = fade(lowpass(horn, 3200), 0.01, 0.12)
    c['drama-boom'] = mix(decay(sweep(95, 32, 1.6), 3), gain(decay(lowpass(noise(1.6, 12), 300), 5), 0.6))
    chord = lambda s, rate: decay(lowpass(mix(osc(110, s, 'saw'), osc(138, s, 'saw'), osc(165, s, 'saw')), 900), rate)
    c['drama-dun-dun-dun'] = cat(chord(0.4, 5), chord(0.4, 5), chord(1.2, 2.2))
    rise = ramp(highpass(noise(1.6, 13), 300), 0.05, 1)
    c['drama-riser'] = fade(mix(rise, ramp(osc(lambda t: 200 + 1400 * (t / 1.6) ** 2, 1.6, 'saw'), 0.03, 0.5)), 0.01, 0.05)
    c['drama-stinger'] = decay(lowpass(mix(osc(440, 1.0, 'saw'), osc(466, 1.0, 'saw'), osc(622, 1.0, 'saw')), 2500), 3)
    thump = decay(osc(60, 0.3), 22)
    beat = mix(at(thump, 0.0, 1.0), at(gain(thump, 0.7), 0.25, 1.0))
    c['drama-heartbeat'] = cat(beat, beat)
    chirp = lambda: fade(mix(osc(4200, 0.05), osc(4300, 0.05)), 0.004, 0.01)
    cricks = silence(2.0)
    for start in (0.0, 0.5, 1.0, 1.5):
        for k in range(3):
            cricks = mix(cricks, at(chirp(), start + k * 0.06, 2.0))
    c['drama-crickets'] = gain(cricks, 0.5)
    r = random.Random(77)
    total = 2.5
    crowd = silence(total)
    for _ in range(330):
        t = r.uniform(0.0, total - 0.05)
        env = min(1.0, t / 0.4, (total - t) / 0.6)
        burst = decay(bandpass(noise(0.05, r.randint(1, 10 ** 6)), 800, 5000), 70)
        crowd = mix(crowd, at(gain(burst, env * r.uniform(0.4, 1.0)), t, total))
    c['drama-applause'] = crowd
    return c


PACKS = [
    # id, name, subfolder ('' keeps the original flat location of the starter pack), description, builder
    ('vocalforge-starter', 'VocalForge starter pack', '', 'Original synthesized sound effects, free for any use.', starter),
    ('retro-games', 'Retro game sounds', 'retro-games', 'Chiptune jumps, power-ups, lasers and explosions.', retro),
    ('stream-alerts', 'Stream alerts', 'stream-alerts', 'Chimes and notification sounds for follows, subs and donations.', alerts),
    ('cartoon-comedy', 'Cartoon and comedy', 'cartoon-comedy', 'Boings, slide whistles, bonks, a rimshot and a record scratch.', cartoon),
    ('drum-kit', 'Drum kit', 'drum-kit', 'Kick, snare, hi-hat, clap, tom, cymbal and cowbell.', drums),
    ('drama-impact', 'Drama and impact', 'drama-impact', 'Air horn, big booms, risers, stingers and a crowd.', drama),
]


def main():
    index = {'packs': []}
    for pack_id, name, folder, description, build in PACKS:
        clips = build()
        entries = []
        for clip_name, sig in clips.items():
            rel = (folder + '/' if folder else '') + clip_name + '.wav'
            write_wav(os.path.join(ROOT, 'sounds', rel), sig)
            entries.append({'name': clip_name + '.wav', 'url': BASE_URL + rel})
        index['packs'].append({'id': pack_id, 'name': name, 'author': 'VocalForge', 'license': 'CC0-1.0', 'description': description, 'clips': entries})
        print(f'{name}: {len(entries)} clips')
    with open(os.path.join(ROOT, 'index.json'), 'w', encoding='utf8') as f:
        json.dump(index, f, indent=2)
        f.write('\n')
    print('wrote', os.path.abspath(os.path.join(ROOT, 'index.json')))


if __name__ == '__main__':
    main()
