"""Synthesizes the original starter-pack clips into catalog/sounds/. They are generated here from
scratch, so they are CC0 and safe to ship. Run: python scripts/make-sample-sounds.py"""
import math
import os
import random
import struct
import wave

OUT = os.path.join(os.path.dirname(__file__), '..', 'catalog', 'sounds')
RATE = 22050


def write(name, samples):
    os.makedirs(OUT, exist_ok=True)
    peak = max(1e-9, max(abs(s) for s in samples))
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(32767 * 0.85 * s / peak)) for s in samples))


def env(i, n, attack=0.01, release=0.3):
    t = i / RATE
    dur = n / RATE
    a = min(1.0, t / attack) if attack else 1.0
    r = min(1.0, (dur - t) / release) if release else 1.0
    return max(0.0, min(a, r))


def tone(freq, dur, shape='sine', decay=0.0):
    n = int(RATE * dur)
    out = []
    for i in range(n):
        ph = 2 * math.pi * freq * i / RATE
        v = math.sin(ph) if shape == 'sine' else (1.0 if math.sin(ph) >= 0 else -1.0)
        out.append(v * env(i, n) * (math.exp(-decay * i / RATE) if decay else 1.0))
    return out


def silence(dur):
    return [0.0] * int(RATE * dur)


# Ding: bright bell-like sine with overtones.
n = int(RATE * 1.2)
write('ding.wav', [(math.sin(2 * math.pi * 880 * i / RATE) + 0.5 * math.sin(2 * math.pi * 1760 * i / RATE) + 0.25 * math.sin(2 * math.pi * 2640 * i / RATE)) * math.exp(-4 * i / RATE) * env(i, n, 0.002, 0.05) for i in range(n)])

# Buzzer: low square wave.
write('buzzer.wav', tone(140, 0.7, 'square'))

# Coin: two quick rising notes.
write('coin.wav', tone(988, 0.08, 'square') + tone(1319, 0.45, 'square', decay=5))

# Sad descending: four falling notes.
write('sad-descent.wav', tone(392, 0.35) + tone(370, 0.35) + tone(349, 0.35) + tone(311, 0.9, decay=2.5))

# Whoosh: filtered noise swell.
random.seed(7)
n = int(RATE * 1.0)
lp = 0.0
whoosh = []
for i in range(n):
    t = i / n
    cutoff = 0.02 + 0.5 * math.sin(math.pi * t) ** 2
    lp += cutoff * (random.uniform(-1, 1) - lp)
    whoosh.append(lp * math.sin(math.pi * t) ** 1.5)
write('whoosh.wav', whoosh)

# Rising arpeggio ("level up").
notes = [523, 659, 784, 1047]
write('level-up.wav', sum((tone(f, 0.12, 'sine') for f in notes[:-1]), []) + tone(notes[-1], 0.6, 'sine', decay=3))

print('wrote clips to', os.path.abspath(OUT))
