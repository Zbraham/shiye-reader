#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拾页 60s 抖音介绍片 · 原创程序化配乐
A 案《墨起金声》：112 BPM，D 小调，古筝/琵琶/箫/太鼓/电子 sub/金铃
B 案《纸上山河》：96 BPM，古筝/箫/二胡式 pad/大鼓/木鱼，无电子

全部用 numpy 合成，无第三方采样。输出 48kHz / 16bit / stereo WAV。
用法： py -3 src/audio.py [--plan A|B|both]
"""
import json
import math
import os
import sys
import wave

import numpy as np

SR = 48000
DUR = 67.5
N = int(round(SR * DUR))
# 2026-11-13: a 7.5 s "story direction" scene was inserted at 33.2; everything after shifts.
SHIFT_AT = 33.2
SHIFT_DT = 7.5
TAU = 2.0 * math.pi
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "out")

# ---------------------------------------------------------------- utilities

def db(x):
    return 20.0 * math.log10(max(x, 1e-12))


def midi(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


_rng = np.random.default_rng(20261112)


def bp_noise(dur, lo, hi, slope=2.2, seed=None):
    """FFT band-passed white noise, peak-normalised."""
    r = np.random.default_rng(seed) if seed is not None else _rng
    n = max(8, int(dur * SR))
    x = r.standard_normal(n).astype(np.float32)
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1.0 / SR)
    mask = 1.0 / (1.0 + (lo / np.maximum(f, 1.0)) ** slope)
    mask *= 1.0 / (1.0 + (f / hi) ** slope)
    y = np.fft.irfft(spec * mask, n).astype(np.float32)
    return y / (np.max(np.abs(y)) + 1e-9)


def env_ar(n, a, r):
    """linear attack / release envelope, times in seconds"""
    tt = np.arange(n) / SR
    e = np.minimum(1.0, tt / max(a, 1e-4))
    if r > 0:
        e *= np.minimum(1.0, np.maximum(0.0, (n / SR - tt) / r))
    return e


# ---------------------------------------------------------------- instruments

def pluck(f, dur, bright=1.0, decay=1.0, seed=0):
    """guzheng-ish additive pluck"""
    n = max(8, int(dur * SR))
    tt = np.arange(n) / SR
    r = np.random.default_rng(1000 + seed)
    sig = np.zeros(n, np.float32)
    for h in range(1, 10):
        amp = (bright ** (h - 1)) / (h ** 1.15)
        if amp < 0.012:
            break
        hd = np.exp(-tt * (1.4 + h * 1.6) / max(dur, 0.12))
        ph = r.uniform(0, TAU)
        sig += (amp * np.sin(TAU * f * h * tt + ph) * hd).astype(np.float32)
    body = (1.0 - np.exp(-tt / 0.0035)) * np.exp(-tt / max(dur * 0.32, 0.07))
    pick = bp_noise(dur, 2600, 9000, seed=2000 + seed) * np.exp(-tt / 0.0065) * 0.12
    return sig * body * 0.55 + pick


def pipa(f, dur=0.42, seed=0):
    return pluck(f, dur, bright=1.28, decay=0.8, seed=seed + 77)


def xiao(f, dur, vib=5.1):
    n = max(8, int(dur * SR))
    tt = np.arange(n) / SR
    e = env_ar(n, min(0.16, dur * 0.2), min(0.34, dur * 0.35))
    v = 1.0 + 0.0045 * np.sin(TAU * vib * tt) * np.minimum(1.0, tt / 0.45)
    ph = TAU * np.cumsum(f * v) / SR
    tone = np.sin(ph) + 0.17 * np.sin(2 * ph + 0.4) + 0.06 * np.sin(3 * ph + 1.1)
    breath = bp_noise(dur, 1100, 4300, seed=int(f)) * 0.10
    return (tone * e + breath * e).astype(np.float32) * 0.8


def pad(f, dur, detune=1.004):
    n = max(8, int(dur * SR))
    tt = np.arange(n) / SR
    e = env_ar(n, min(0.8, dur * 0.3), min(0.9, dur * 0.4))
    a = np.sin(TAU * f * tt) + 0.75 * np.sin(TAU * f * detune * tt + 0.6)
    a += 0.30 * np.sin(TAU * 2 * f * tt + 1.2) + 0.12 * np.sin(TAU * 3 * f * tt + 0.2)
    return (a * e).astype(np.float32) * 0.45


def taiko(f0=118, f1=47, dur=0.9, hard=1.0):
    n = max(8, int(dur * SR))
    tt = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-tt / 0.042)
    ph = TAU * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-tt / 0.30) * (1.0 - np.exp(-tt / 0.002))
    nz = bp_noise(dur, 70, 1200, seed=31) * np.exp(-tt / 0.028) * 0.20 * hard
    return (body * 0.95 + nz).astype(np.float32)


def bigdrum(dur=1.2):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = 72 + 34 * np.exp(-tt / 0.06)
    ph = TAU * np.cumsum(f) / SR
    e = np.exp(-tt / 0.55) * (1 - np.exp(-tt / 0.004))
    return (np.sin(ph) * e * 0.9 + bp_noise(dur, 50, 700, seed=41) * np.exp(-tt / 0.04) * 0.25).astype(np.float32)


def woodfish():
    n = int(0.12 * SR)
    tt = np.arange(n) / SR
    e = np.exp(-tt / 0.022) * (1 - np.exp(-tt / 0.001))
    return (np.sin(TAU * 760 * tt) * 0.65 + bp_noise(0.12, 1200, 6500, seed=51) * 0.35 * np.exp(-tt / 0.006)) * e


def bell(base=880, dur=2.6, amp=1.0):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    sig = np.zeros(n, np.float32)
    for ratio, a, d in ((1.0, 1.0, 0.55), (2.76, 0.52, 0.38), (5.40, 0.26, 0.24), (8.93, 0.12, 0.15)):
        sig += (a * np.sin(TAU * base * ratio * tt + ratio) * np.exp(-tt / (dur * d))).astype(np.float32)
    att = (1 - np.exp(-tt / 0.0018))
    return sig * att * amp * 0.5


def click(f=900, dur=0.09):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    e = np.exp(-tt / 0.012)
    return (np.sin(TAU * f * tt) * 0.5 + bp_noise(dur, 1600, 7000, seed=61) * 0.4) * e


def paper(dur=0.34, seed=71):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    e = (1 - np.exp(-tt / 0.012)) * np.exp(-tt / 0.085)
    grit = bp_noise(dur, 700, 8000, seed=seed)
    hiss = bp_noise(dur, 3000, 12000, seed=seed + 1) * 0.25
    return (grit + hiss) * e * 0.55


def sweep_noise(dur, lo0, hi0, lo1, hi1, seed=81):
    """chunked band-pass whose centre rises; hann overlap-add"""
    n = int(dur * SR)
    out = np.zeros(n, np.float32)
    win = max(16, int(0.06 * SR))
    hop = win // 2
    cnt = (n - win) // hop + 1
    for k in range(cnt):
        p = k / max(1, cnt - 1)
        lo = lo0 + (lo1 - lo0) * p
        hi = hi0 + (hi1 - hi0) * p
        seg = bp_noise(win / SR, lo, hi, seed=seed + k)
        # fade chunk edges with a hann window
        h = np.hanning(win).astype(np.float32)
        i = k * hop
        out[i:i + win] += seg * h
    out /= (np.max(np.abs(out)) + 1e-9)
    e = env_ar(n, 0.05, 0.10)
    return out * e


def whoosh(dur=0.55, up=True, seed=81):
    if up:
        return sweep_noise(dur, 300, 1400, 2500, 9000, seed=seed)
    return sweep_noise(dur, 2500, 9000, 300, 1400, seed=seed)


def riser(dur=1.2, seed=91):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    nz = sweep_noise(dur, 400, 1600, 3000, 11000, seed=seed)
    tone = np.sin(TAU * np.cumsum(140 + 520 * (tt / dur) ** 2) / SR) * 0.12
    e = (tt / dur) ** 2.2
    return (nz * 0.75 + tone) * e


def inkdrop():
    n = int(1.1 * SR)
    tt = np.arange(n) / SR
    f = 58 + 132 * np.exp(-tt / 0.09)
    ph = TAU * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-tt / 0.22) * (1 - np.exp(-tt / 0.002))
    nz = bp_noise(1.1, 200, 2200, seed=101) * np.exp(-tt / 0.05) * 0.35
    return (body * 0.8 + nz).astype(np.float32)


def brush(dur=0.55):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    e = np.minimum(1, tt / 0.05) * np.exp(-tt / 0.16)
    return bp_noise(dur, 2200, 8000, seed=111) * e * 0.5


def lock_click():
    n = int(0.35 * SR)
    tt = np.arange(n) / SR
    e = np.exp(-tt / 0.05)
    return (bp_noise(0.35, 2400, 9000, seed=121) * 0.5 + np.sin(TAU * 1650 * tt) * 0.3 +
            np.sin(TAU * 2400 * tt) * 0.18) * e


def cricket(dur=0.5):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    am = (0.5 + 0.5 * np.sin(TAU * 42 * tt)) ** 5
    e = np.minimum(1, tt / 0.02) * np.minimum(1, (dur - tt) / 0.05)
    return (np.sin(TAU * 4300 * tt) * am * e * 0.25).astype(np.float32)


# ---------------------------------------------------------------- mixer

class Mix:
    def __init__(self):
        self.L = np.zeros(N, np.float32)
        self.R = np.zeros(N, np.float32)
        self.WL = np.zeros(N, np.float32)
        self.WR = np.zeros(N, np.float32)

    def add(self, sig, t0, gain=1.0, pan=0.0, send=0.0, shift=True):
        if gain <= 0 or sig is None:
            return
        if shift and t0 >= SHIFT_AT:
            t0 += SHIFT_DT
        i0 = int(round(t0 * SR))
        if i0 >= N:
            return
        if i0 < 0:
            sig = sig[-i0:]
            i0 = 0
        n = min(len(sig), N - i0)
        if n <= 0:
            return
        s = (sig[:n] * gain).astype(np.float32)
        ang = (pan + 1.0) * math.pi / 4.0
        gl, gr = math.cos(ang), math.sin(ang)
        self.L[i0:i0 + n] += s * gl
        self.R[i0:i0 + n] += s * gr
        if send > 0:
            self.WL[i0:i0 + n] += s * gl * send
            self.WR[i0:i0 + n] += s * gr * send

    def finish(self, reverb_wet=0.20):
        # synthetic stereo impulse: dark, 1.4 s, 18 ms pre-delay, no low-end build-up
        irn = int(1.4 * SR)
        it = np.arange(irn) / SR
        pre = int(0.018 * SR)

        def make_ir(seed):
            ir = bp_noise(irn / SR, 260, 6500, seed=seed) * np.exp(-it / 0.38)
            ir = np.concatenate([np.zeros(pre, np.float32), ir])[:irn]
            ir /= (np.sqrt(np.sum(ir ** 2)) + 1e-9)
            return ir.astype(np.float32)

        nfft = 1 << (N + irn - 1).bit_length()
        irL = make_ir(1201)
        irR = make_ir(1202)
        wetL = np.fft.irfft(np.fft.rfft(self.WL, nfft) * np.fft.rfft(irL, nfft), nfft)[:N].astype(np.float32)
        wetR = np.fft.irfft(np.fft.rfft(self.WR, nfft) * np.fft.rfft(irR, nfft), nfft)[:N].astype(np.float32)
        outL = self.L + wetL * reverb_wet
        outR = self.R + wetR * reverb_wet
        # gentle fades
        fi = int(0.04 * SR)
        outL[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
        outR[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
        fo = int(0.45 * SR)
        outL[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32) ** 1.5
        outR[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32) ** 1.5
        # soft knee limiter, then peak normalise to 0.92
        peak = max(np.max(np.abs(outL)), np.max(np.abs(outR)))
        if peak > 1e-9:
            outL *= 0.92 / peak
            outR *= 0.92 / peak
        return outL, outR


def write_wav(path, L, R):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = np.empty(N * 2, np.int16)
    data[0::2] = np.clip(L * 32767.0, -32768, 32767).astype(np.int16)
    data[1::2] = np.clip(R * 32767.0, -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


# ---------------------------------------------------------------- score A

D2, D3, F3, A3, C4, D4, E4, F4, G4, A4, Bb4, C5, D5, F5, A5, D6 = (
    38, 50, 53, 57, 60, 62, 64, 65, 67, 69, 70, 72, 74, 77, 81, 86)


def chord_bar(mix, t0, bar, dur, root, gain=0.16, send=0.35):
    """guzheng arpeggio, 8 eighth notes over one bar"""
    steps = [0, 7, 12, 7, 0, 7, 12, 7]
    for i, s in enumerate(steps):
        f = midi(root + 12 + s)
        mix.add(pluck(f, 1.1, bright=0.9, seed=int(root * 7 + i)),
                t0 + i * dur / 8, gain * (0.9 if i % 2 == 0 else 0.6), -0.15 + 0.3 * (i % 2), send)


def score_A():
    m = Mix()
    B = 60.0 / 112.0  # 0.5357 s

    # ---- S1 0–4.8 : ink drop, paper bloom, writing, particles, seal
    m.add(pad(midi(D2), 5.2), 0.0, 0.30, 0.0, 0.5)
    m.add(pad(midi(A3), 5.0), 0.0, 0.10, -0.2, 0.5)
    m.add(inkdrop(), 0.55, 0.85, 0.0, 0.45)
    m.add(taiko(90, 44, 1.2), 0.55, 0.30, 0.0, 0.4)
    m.add(brush(0.7), 1.55, 0.45, -0.05, 0.3)
    m.add(whoosh(0.7, True), 2.62, 0.36, 0.15, 0.35)
    m.add(bell(880, 2.8, 0.55), 3.58, 0.55, 0.2, 0.6)
    m.add(taiko(105, 45, 1.1), 3.60, 0.42, 0.0, 0.35)
    m.add(stamp := bigdrum(1.0), 4.32, 0.45, 0.0, 0.35)
    m.add(riser(0.75), 4.05, 0.28, 0.0, 0.4)

    # ---- S2 4.8–10.6 : motif, typing, skeleton cards
    m.add(pad(midi(D3), 5.9), 4.82, 0.13, 0.0, 0.35)
    for i in range(5):
        m.add(taiko(84, 46, 0.5), 4.82 + i * 1.0714, 0.13, 0.0, 0.15)
    motif = [D4, F4, A4]
    for i, n in enumerate(motif):
        m.add(pluck(midi(n), 1.5, 1.0, seed=i), 5.30 + i * 0.42, 0.30, -0.2 + 0.2 * i, 0.4)
    m.add(pluck(midi(D5), 2.0), 6.42, 0.22, 0.15, 0.45)
    for i in range(14):
        m.add(click(950 + (i % 3) * 90, 0.05), 6.62 + i * 0.095, 0.085, 0.2, 0.0)
    m.add(taiko(120, 48, 1.1), 8.08, 0.55, 0.0, 0.3)
    m.add(paper(0.5, 81), 8.08, 0.45, 0.0, 0.3)
    for i in range(3):
        m.add(paper(0.26, 83 + i), 8.28 + i * 0.16, 0.25, -0.3 + 0.3 * i, 0.25)
        m.add(taiko(95, 50, 0.55), 8.29 + i * 0.16, 0.14, -0.3 + 0.3 * i, 0.2)
    for i, n in enumerate((D4, F4, A4, C5, D5, F5)):
        m.add(pluck(midi(n), 1.0, 1.0, seed=10 + i), 9.35 + i * 0.13, 0.13, -0.4 + 0.16 * i, 0.35)
    m.add(riser(0.55), 10.05, 0.18, 0.0, 0.3)

    # ---- S3 10.6–18.2 : pre-writing, taiko + pulse + bells, seal
    prog = [50, 46, 41, 48]
    t = 10.6
    m.add(pad(midi(D3), 7.6), 10.6, 0.12, 0.0, 0.3)
    bar = B * 4
    k = 0
    while t < 18.0:
        root = prog[k % 4]
        chord_bar(m, t, bar, bar, root, 0.15, 0.30)
        # taiko on 1 and 3
        m.add(taiko(115, 46, 0.9), t, 0.42, 0.0, 0.25)
        m.add(taiko(100, 45, 0.8), t + bar / 2, 0.32, 0.0, 0.25)
        # electronic sub pulse, eighths (kept above 80 Hz so phone speakers carry it)
        for j in range(8):
            if j % 2 == 0:
                n = int(0.20 * SR)
                tt = np.arange(n) / SR
                env = np.exp(-tt / 0.07) * (1 - np.exp(-tt / 0.004))
                f0 = midi(root)
                sub = ((np.sin(TAU * f0 * tt) + 0.35 * np.sin(TAU * 2 * f0 * tt)) * env).astype(np.float32)
                m.add(sub, t + j * bar / 8, 0.20, 0.0, 0.0)
        t += bar
        k += 1
    for i, (tt0, n) in enumerate(((13.00, A5), (13.45, C5 + 12), (13.90, D6))):
        m.add(bell(midi(n), 2.2, 0.6), tt0, 0.55, 0.35 - 0.3 * i, 0.55)
    m.add(bigdrum(1.0), 15.55, 0.5, 0.0, 0.3)
    m.add(paper(0.35, 91), 15.56, 0.35, 0.0, 0.25)
    m.add(riser(0.9), 17.35, 0.35, 0.0, 0.45)

    # ---- S4 18.2–25.8 : selection / rewrite / diff / apply
    t = 18.2
    m.add(pad(midi(D3), 7.2), 18.2, 0.12, 0.0, 0.25)
    k = 0
    while t < 25.4:
        root = prog[k % 4]
        # pipa 16ths
        for j in range(16):
            n = [root + 24, root + 31, root + 36, root + 31][j % 4]
            vel = 0.16 if j % 4 == 0 else 0.09
            m.add(pipa(midi(n), 0.34, seed=j + k * 17), t + j * bar / 16, vel,
                  -0.25 + 0.12 * (j % 4), 0.25)
        m.add(taiko(120, 46, 0.7), t, 0.34, 0.0, 0.2)
        m.add(taiko(95, 44, 0.6), t + bar / 2, 0.25, 0.0, 0.2)
        t += bar
        k += 1
    m.add(paper(0.24, 111), 19.05, 0.45, -0.2, 0.15)
    m.add(click(1050), 19.55, 0.16, 0.1, 0.1)
    m.add(click(820), 20.25, 0.16, -0.1, 0.1)
    m.add(whoosh(0.45, True, seed=131), 21.28, 0.28, 0.0, 0.3)
    for i in range(6):
        m.add(click(1600 + i * 120, 0.04), 21.7 + i * 0.12, 0.045, 0.3 - i * 0.1, 0.0)
    for i, n in enumerate((D5, F5, A5, D6)):
        m.add(bell(midi(n), 1.6, 0.5), 23.20 + i * 0.075, 0.30, -0.2 + i * 0.14, 0.55)
    m.add(bigdrum(0.9), 23.20, 0.28, 0.0, 0.25)
    m.add(riser(0.6), 25.1, 0.28, 0.0, 0.4)

    # ---- S5 25.8–33.2 : control panel
    m.add(whoosh(0.5, True, seed=141), 25.82, 0.36, 0.2, 0.3)
    m.add(pad(midi(D3), 7.3), 25.8, 0.16, 0.0, 0.3)
    for i in range(14):
        tt0 = 25.8 + i * B
        m.add(taiko(88, 45, 0.45), tt0, 0.28 if i % 2 == 0 else 0.19, 0.0, 0.18)
        if i % 2 == 0:
            n = int(0.16 * SR)
            tt = np.arange(n) / SR
            sub = (np.sin(TAU * midi(D3) * tt) * np.exp(-tt / 0.06) * (1 - np.exp(-tt / 0.004))).astype(np.float32)
            m.add(sub, tt0, 0.16, 0.0, 0.0)
    for i in range(16):
        m.add(pluck(midi([D4, A3, F4, A3][i % 4]), 0.7, 0.85, seed=500 + i),
              26.0 + i * 0.447, 0.11, -0.25 + 0.1 * (i % 2), 0.3)
    for i in range(3):
        m.add(click(880 + i * 120), 29.05 + i * 0.28, 0.14, -0.2 + i * 0.2, 0.1)
        m.add(taiko(80, 52, 0.35), 29.05 + i * 0.28, 0.16, 0.0, 0.1)
    # panel clicks and a low pulse
    for i in range(4):
        m.add(click(960), 27.0 + i * 1.07, 0.07, 0.25, 0.0)
    m.add(sweep_noise(0.7, 1200, 3000, 4000, 9000, seed=151), 31.55, 0.38, 0.0, 0.3)
    m.add(bell(midi(A5), 1.8, 0.4), 31.82, 0.22, 0.3, 0.5)
    m.add(riser(0.55), 32.55, 0.22, 0.0, 0.35)

    # ---- S5B 33.2–40.7 : story direction, inserted scene (no shift)
    m.add(pad(midi(D3), 7.4), 33.2, 0.22, 0.0, 0.5, shift=False)
    m.add(pad(midi(A3), 7.0), 33.2, 0.07, 0.2, 0.5, shift=False)
    m.add(taiko(80, 45, 0.5), 33.22, 0.26, 0.0, 0.3, shift=False)
    for i, n in enumerate((D4, F4, A4)):
        m.add(pluck(midi(n), 1.6, 1.0, seed=160 + i), 33.62 + i * 0.42, 0.18,
              -0.25 + i * 0.2, 0.45, shift=False)
    for i in range(3):
        m.add(click(1200 + i * 90, 0.05), 35.08 + i * 0.12, 0.06, 0.3, 0.1, shift=False)
    m.add(taiko(90, 50, 0.7), 36.22, 0.30, 0.0, 0.25, shift=False)
    m.add(bell(midi(A5), 1.8, 0.4), 36.25, 0.20, 0.25, 0.6, shift=False)
    m.add(whoosh(0.8, True, seed=161), 37.30, 0.30, 0.0, 0.35, shift=False)
    for i, n in enumerate((D5, F5, A5)):
        m.add(bell(midi(n), 1.6, 0.35), 37.95 + i * 0.12, 0.22, -0.15 + i * 0.15, 0.55, shift=False)
    m.add(riser(0.55), 39.9, 0.14, 0.0, 0.3, shift=False)

    # ---- S6 33.2–39.8 : night reading, sparse
    m.add(paper(0.42, 161), 33.22, 0.42, 0.0, 0.2)
    m.add(pad(midi(D3), 6.4), 33.2, 0.10, 0.0, 0.5)
    m.add(pad(midi(A3), 6.2), 33.2, 0.05, 0.2, 0.5)
    for i, (tt0, n, dur) in enumerate((
            (33.55, D4, 1.5), (34.30, F4, 1.2), (35.00, E4, 1.4),
            (35.75, D4, 1.1), (36.35, A3, 2.2))):
        m.add(xiao(midi(n), dur), tt0, 0.085, -0.15 + 0.1 * (i % 2), 0.55)
    for i, tt0 in enumerate((34.65, 36.10, 37.55)):
        m.add(bell(midi(A5), 1.4, 0.25), tt0, 0.09, 0.25, 0.5)
    for i in range(14):
        m.add(cricket(0.42), 37.3 + i * 0.35, 0.060, -0.5 + 0.08 * (i % 6), 0.2)
    m.add(riser(0.55), 39.3, 0.16, 0.0, 0.3)

    # ---- S7 39.8–46.8 : local data, models
    m.add(pad(midi(D2), 7.2), 39.8, 0.27, 0.0, 0.45)
    for i in range(6):
        m.add(taiko(80, 46, 0.4), 41.0 + i * 1.0714, 0.09, 0.0, 0.15)
    m.add(inkdrop(), 39.82, 0.55, 0.0, 0.4)
    m.add(taiko(80, 42, 1.2), 39.82, 0.28, 0.0, 0.3)
    m.add(lock_click(), 40.55, 0.40, 0.15, 0.4)
    for i in range(6):
        m.add(click(1400 + i * 60, 0.06), 41.1 + i * 0.11, 0.045, -0.4 + i * 0.15, 0.2)
    for i, n in enumerate((D5, F5, A5, C5 + 12, D6)):
        m.add(bell(midi(n), 1.3, 0.35), 42.20 + i * 0.24, 0.28, -0.35 + i * 0.18, 0.55)
    for i in range(4):
        m.add(taiko(70, 40, 0.6), 43.3 + i * 0.8, 0.15, 0.0, 0.15)
    m.add(riser(0.85), 46.0, 0.30, 0.0, 0.4)

    # ---- S8 46.8–53.4 : bookshelf, export
    m.add(whoosh(0.45, True, seed=181), 46.82, 0.38, 0.0, 0.3)
    m.add(pad(midi(D3), 6.4), 46.8, 0.14, 0.0, 0.3)
    for i, n in enumerate((D4, A3, F4, D4, A3, F4)):
        m.add(pluck(midi(n), 0.9, 0.9, seed=600 + i), 47.0 + i * 0.22, 0.08, -0.2 + 0.1 * (i % 2), 0.3)
    for i in range(9):
        m.add(taiko(80, 45, 0.35), 48.9 + i * 0.536, 0.07, 0.0, 0.12)
    for i in range(6):
        m.add(taiko(110, 60, 0.30), 48.0 + i * 0.13, 0.17, -0.4 + i * 0.16, 0.18)
        m.add(paper(0.18, 191 + i), 48.0 + i * 0.13, 0.16, -0.4 + i * 0.16, 0.2)
    for i, n in enumerate((D4, F4, A4, D5, F5, A5)):
        m.add(pluck(midi(n), 1.4, 1.0, seed=30 + i), 48.9 + i * 0.17, 0.13, -0.35 + i * 0.14, 0.4)
    m.add(whoosh(1.15, True, seed=201), 50.6, 0.35, 0.15, 0.35)
    m.add(bell(midi(D6), 2.2, 0.55), 51.55, 0.40, 0.25, 0.6)
    m.add(taiko(90, 50, 0.8), 51.55, 0.18, 0.0, 0.2)
    m.add(riser(0.7), 52.7, 0.28, 0.0, 0.4)

    # ---- S9 53.4–60 : icon, tagline, seal, tail
    m.add(bigdrum(1.2), 53.4, 0.55, 0.0, 0.35)
    m.add(pad(midi(D2), 6.4), 53.4, 0.24, 0.0, 0.5)
    m.add(pad(midi(A3), 6.0), 53.4, 0.10, 0.15, 0.5)
    for i, n in enumerate((D4, F4, A4, D5)):
        m.add(pluck(midi(n), 1.8, 1.0, seed=51 + i), 54.15 + i * 0.25, 0.22, -0.3 + i * 0.2, 0.5)
    for i, n in enumerate((A5, C5 + 12, D6)):
        m.add(bell(midi(n), 2.4, 0.5), 55.15 + i * 0.16, 0.32, -0.2 + i * 0.2, 0.6)
    m.add(bigdrum(1.4), 57.58, 0.88, 0.0, 0.45)
    m.add(paper(0.5, 211), 57.58, 0.30, 0.0, 0.35)
    m.add(bell(midi(D6), 2.4, 0.5), 57.62, 0.32, 0.2, 0.65)
    n_tail = int(2.2 * SR)
    tt = np.arange(n_tail) / SR
    tail = (np.sin(TAU * midi(D5) * tt) * 0.35 + np.sin(TAU * midi(A4) * tt) * 0.2) * np.exp(-tt / 0.55)
    m.add(tail.astype(np.float32), 57.65, 0.22, 0.0, 0.6)
    return m


# ---------------------------------------------------------------- score B

def score_B():
    m = Mix()
    B = 60.0 / 96.0  # 0.625

    # S1 free opening
    m.add(pad(midi(D2), 5.6, 1.002), 0.0, 0.34, 0.0, 0.6)
    m.add(inkdrop(), 0.55, 0.75, 0.0, 0.5)
    m.add(brush(0.75), 1.55, 0.50, -0.05, 0.35)
    m.add(pluck(midi(D3), 2.2, 0.9, seed=301), 2.35, 0.26, -0.1, 0.5)
    m.add(pluck(midi(A3), 2.2, 0.9, seed=302), 3.05, 0.22, 0.1, 0.5)
    m.add(bell(midi(A5), 3.0, 0.4), 3.60, 0.35, 0.2, 0.6)
    m.add(bigdrum(1.0), 4.35, 0.35, 0.0, 0.4)

    # S2
    m.add(pad(midi(D3), 5.6, 1.002), 4.9, 0.12, 0.0, 0.4)
    for i, n in enumerate((D4, F4, A4)):
        m.add(pluck(midi(n), 1.8, 0.95, seed=310 + i), 5.20 + i * 0.55, 0.28, -0.2 + 0.2 * i, 0.5)
    for i in range(10):
        m.add(woodfish(), 6.55 + i * 0.22, 0.10, 0.2, 0.1)
    m.add(bigdrum(1.0), 8.10, 0.40, 0.0, 0.35)
    m.add(paper(0.5, 311), 8.10, 0.35, 0.0, 0.3)
    for i, n in enumerate((D4, F4, A4, C5, D5)):
        m.add(pluck(midi(n), 1.2, 0.95, seed=320 + i), 9.1 + i * 0.18, 0.13, -0.3 + 0.15 * i, 0.4)

    # S3 : woodfish pulse + guzheng, no sub
    t = 10.6
    m.add(pad(midi(D3), 7.6), 10.6, 0.12, 0.0, 0.3)
    bar = B * 4
    prog = [50, 46, 41, 48]
    k = 0
    while t < 18.0:
        root = prog[k % 4]
        for j in range(4):
            m.add(woodfish(), t + j * bar / 4, 0.10 if j % 2 else 0.13, -0.15, 0.1)
        for j in (0, 2, 3, 5, 6):
            m.add(pluck(midi(root + 12 + [0, 7, 12, 7, 12, 7][j % 6]), 1.3,
                        0.9, seed=k * 9 + j), t + j * bar / 8, 0.12, -0.2, 0.4)
        m.add(bigdrum(0.9), t, 0.22, 0.0, 0.3)
        t += bar
        k += 1
    for i, n in enumerate((A5, C5 + 12, D6)):
        m.add(bell(midi(n), 2.2, 0.4), 13.0 + i * 0.45, 0.26, 0.3 - 0.25 * i, 0.55)
    m.add(bigdrum(1.1), 15.55, 0.40, 0.0, 0.35)

    m.add(riser(0.8, seed=751), 17.35, 0.20, 0.0, 0.35)

    # S4 : light but continuous
    m.add(pad(midi(D3), 7.2, 1.002), 18.2, 0.12, 0.0, 0.4)
    for i in range(4):
        m.add(bigdrum(0.9), 18.3 + i * 2.1, 0.10, 0.0, 0.25)
    for i in range(28):
        m.add(pluck(midi([62, 69, 65, 69][i % 4]), 0.8, 0.85, seed=700 + i),
              18.5 + i * 0.25, 0.055, -0.2 + 0.1 * (i % 2), 0.3)
    m.add(paper(0.25, 331), 19.05, 0.30, -0.2, 0.15)
    for i, n in enumerate((D5, F5, A5, D6)):
        m.add(pluck(midi(n), 1.1, 0.95, seed=340 + i), 20.4 + i * 0.22, 0.16, -0.2 + 0.12 * i, 0.4)
    m.add(whoosh(0.5, True, seed=341), 21.3, 0.22, 0.0, 0.3)
    for i, n in enumerate((D5, F5, A5)):
        m.add(bell(midi(n), 1.5, 0.35), 23.2 + i * 0.12, 0.20, -0.15 + i * 0.15, 0.5)

    # S5 : sparse drum + woodfish
    m.add(pad(midi(D3), 7.3, 1.002), 25.8, 0.12, 0.0, 0.4)
    for i in range(7):
        m.add(bigdrum(0.9), 25.8 + i * 1.0714, 0.14, 0.0, 0.3)
    for i in range(7):
        m.add(woodfish(), 25.9 + i * 0.62, 0.07, 0.2, 0.1)
    for i in range(3):
        m.add(woodfish(), 29.1 + i * 0.3, 0.10, -0.2 + i * 0.2, 0.1)
    m.add(sweep_noise(0.8, 800, 2600, 3000, 7000, seed=351), 31.5, 0.22, 0.0, 0.3)

    # S5B 33.2–40.7 : story direction, inserted scene (chamber version, no shift)
    m.add(pad(midi(D3), 7.4, 1.002), 33.2, 0.16, 0.0, 0.5, shift=False)
    m.add(pad(midi(A3), 7.0, 1.002), 33.2, 0.06, 0.2, 0.5, shift=False)
    m.add(bigdrum(1.0), 33.22, 0.30, 0.0, 0.35, shift=False)
    for i, n in enumerate((D4, F4, A4)):
        m.add(pluck(midi(n), 1.8, 0.95, seed=360 + i), 33.62 + i * 0.46, 0.20,
              -0.25 + i * 0.2, 0.45, shift=False)
    for i in range(3):
        m.add(woodfish(), 35.08 + i * 0.12, 0.08, 0.3, 0.1, shift=False)
    m.add(bigdrum(1.0), 36.22, 0.34, 0.0, 0.3, shift=False)
    m.add(bell(midi(A5), 2.0, 0.4), 36.25, 0.22, 0.25, 0.6, shift=False)
    m.add(sweep_noise(0.8, 800, 2600, 3000, 7000, seed=361), 37.30, 0.20, 0.0, 0.35, shift=False)
    for i, n in enumerate((D5, F5, A5)):
        m.add(bell(midi(n), 1.6, 0.35), 37.95 + i * 0.12, 0.20, -0.15 + i * 0.15, 0.55, shift=False)

    # S6 : xiao solo, warm pad
    m.add(paper(0.42, 361), 33.22, 0.28, 0.0, 0.2)
    m.add(pad(midi(D3), 6.4, 1.003), 33.2, 0.12, 0.0, 0.55)
    m.add(pad(midi(A3), 6.2, 1.002), 33.2, 0.07, 0.2, 0.55)
    for i, (tt0, n, dur) in enumerate((
            (33.60, D4, 1.8), (34.45, F4, 1.6), (35.25, E4, 1.6),
            (36.05, D4, 1.4), (36.70, A3, 2.6))):
        m.add(xiao(midi(n), dur, 4.8), tt0, 0.10, -0.1 + 0.08 * (i % 2), 0.6)
    for i in range(12):
        m.add(cricket(0.42), 37.4 + i * 0.36, 0.06, -0.5 + 0.08 * (i % 6), 0.2)

    # S7 : low drone, wood, soft bells
    m.add(pad(midi(D2), 7.2, 1.002), 39.8, 0.26, 0.0, 0.5)
    m.add(inkdrop(), 39.82, 0.50, 0.0, 0.4)
    m.add(lock_click(), 40.55, 0.32, 0.15, 0.4)
    for i, n in enumerate((D5, F5, A5, C5 + 12)):
        m.add(bell(midi(n), 1.5, 0.35), 42.2 + i * 0.32, 0.26, -0.3 + i * 0.2, 0.55)
    for i in range(4):
        m.add(woodfish(), 43.4 + i * 0.9, 0.06, 0.0, 0.1)

    # S8 : books, export
    m.add(pad(midi(D3), 5.6, 1.002), 46.8, 0.11, 0.0, 0.4)
    for i in range(6):
        m.add(bigdrum(0.5), 48.0 + i * 0.14, 0.10, -0.4 + i * 0.16, 0.2)
        m.add(paper(0.18, 371 + i), 48.0 + i * 0.14, 0.13, -0.4 + i * 0.16, 0.2)
    for i, n in enumerate((D4, F4, A4, D5, F5)):
        m.add(pluck(midi(n), 1.5, 0.95, seed=380 + i), 49.0 + i * 0.2, 0.14, -0.3 + 0.15 * i, 0.45)
    m.add(whoosh(1.2, True, seed=391), 50.6, 0.30, 0.1, 0.35)
    m.add(bell(midi(D6), 2.4, 0.4), 51.6, 0.30, 0.2, 0.6)

    # S9 : big drum + guzheng harmonic tail
    m.add(bigdrum(1.4), 53.4, 0.60, 0.0, 0.4)
    m.add(pad(midi(D2), 6.4, 1.002), 53.4, 0.26, 0.0, 0.55)
    for i, n in enumerate((D4, F4, A4, D5)):
        m.add(pluck(midi(n), 2.0, 0.95, seed=401 + i), 54.2 + i * 0.3, 0.20, -0.3 + 0.2 * i, 0.5)
    m.add(bigdrum(1.6), 57.60, 0.85, 0.0, 0.45)
    n_tail = int(2.0 * SR)
    tt = np.arange(n_tail) / SR
    tail = np.sin(TAU * midi(D5) * tt) * np.exp(-tt / 0.6) * 0.4
    m.add(tail.astype(np.float32), 57.65, 0.21, 0.0, 0.6)
    return m


# ---------------------------------------------------------------- main

def main():
    plan = "both"
    if "--plan" in sys.argv:
        plan = sys.argv[sys.argv.index("--plan") + 1]
    os.makedirs(OUT, exist_ok=True)
    report = {"sample_rate": SR, "duration": DUR, "channels": 2, "bit_depth": 16, "files": {}}
    jobs = []
    if plan in ("A", "both"):
        jobs.append(("A", os.path.join(OUT, "audio_A.wav"), score_A))
    if plan in ("B", "both"):
        jobs.append(("B", os.path.join(OUT, "audio_B.wav"), score_B))
    for name, path, fn in jobs:
        print("synth", name, "...", flush=True)
        mix = fn()
        L, R = mix.finish()
        write_wav(path, L, R)
        peak = float(max(np.max(np.abs(L)), np.max(np.abs(R))))
        rms = float(np.sqrt((np.mean(L.astype(np.float64) ** 2) + np.mean(R.astype(np.float64) ** 2)) / 2))
        info = {
            "path": os.path.relpath(path, ROOT).replace("\\", "/"),
            "bytes": os.path.getsize(path),
            "peak_dbfs": round(db(peak), 2),
            "rms_dbfs": round(db(rms), 2),
            "crest_db": round(db(peak) - db(rms), 1),
        }
        report["files"][name] = info
        print(json.dumps(info, ensure_ascii=False), flush=True)
    with open(os.path.join(OUT, "audio_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("AUDIO_OK", flush=True)


if __name__ == "__main__":
    main()
