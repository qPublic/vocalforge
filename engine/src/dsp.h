// Voice chain DSP. Each stage is a faithful port of the matching AudioWorklet in renderer/*.js
// (and the Web Audio biquad formulas for the EQ), so the two engines sound the same.
#pragma once
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>
#include "params.h"

extern "C" {
#include "../third_party/rnnoise/rnnoise.h"
}

namespace vf {

constexpr double kPi = 3.14159265358979323846;
constexpr int kRate = 48000;
constexpr int kMaxBlock = 4096;

inline double dbToLin(double db) { return std::pow(10.0, db / 20.0); }

// ---------- biquad (RBJ cookbook, as specified for Web Audio's BiquadFilterNode) ----------
struct Biquad {
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  double x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  inline double process(double x) {
    const double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  }
  void set(double nb0, double nb1, double nb2, double na0, double na1, double na2) {
    b0 = nb0 / na0;
    b1 = nb1 / na0;
    b2 = nb2 / na0;
    a1 = na1 / na0;
    a2 = na2 / na0;
  }
  // Q is in dB for high-pass, like Web Audio.
  void highpass(double f, double qDb) {
    const double w0 = 2 * kPi * f / kRate, c = std::cos(w0), alpha = std::sin(w0) / (2 * std::pow(10.0, qDb / 20.0));
    set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
  }
  void lowShelf(double f, double gainDb) {
    const double A = std::pow(10.0, gainDb / 40.0), w0 = 2 * kPi * f / kRate, c = std::cos(w0);
    const double sq = 2 * std::sqrt(A) * (std::sin(w0) / 2 * std::sqrt(2.0));  // shelf slope S = 1
    set(A * ((A + 1) - (A - 1) * c + sq), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sq),
        (A + 1) + (A - 1) * c + sq, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sq);
  }
  void highShelf(double f, double gainDb) {
    const double A = std::pow(10.0, gainDb / 40.0), w0 = 2 * kPi * f / kRate, c = std::cos(w0);
    const double sq = 2 * std::sqrt(A) * (std::sin(w0) / 2 * std::sqrt(2.0));
    set(A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq),
        (A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq);
  }
  void peaking(double f, double q, double gainDb) {
    const double A = std::pow(10.0, gainDb / 40.0), w0 = 2 * kPi * f / kRate, c = std::cos(w0);
    const double alpha = std::sin(w0) / (2 * q);
    set(1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A);
  }
};

// ---------- noise gate (gate-processor.js) ----------
struct Gate {
  double env = 0, gain = 1;
  void process(float* x, int n, const Params& p) {
    const double thr = dbToLin(p.gateThr), floorLin = dbToLin(-80);
    const double aCoef = std::exp(-1.0 / (kRate * 0.005)), rCoef = std::exp(-1.0 / (kRate * p.gateRel));
    for (int i = 0; i < n; i++) {
      const double peak = std::fabs((double)x[i]);
      env = peak > env ? peak : env * 0.9995 + peak * 0.0005;
      const double target = (!p.gateOn || env > thr) ? 1 : floorLin;
      const double c = target > gain ? aCoef : rCoef;
      gain = target + (gain - target) * c;
      x[i] = (float)(x[i] * gain);
    }
  }
};

// ---------- de-esser (deesser-processor.js): Linkwitz-Riley split, only the high band is turned down ----------
struct DeEsser {
  Biquad hp1, hp2, lp1, lp2;
  double coefFreq = 0, hb0, hb1, lb0, lb1, a1, a2;
  double env = 0, gain = 1;

  static inline double bq(Biquad& s, double x, double b0, double b1, double a1, double a2) {
    const double y = b0 * x + b1 * s.x1 + b0 * s.x2 - a1 * s.y1 - a2 * s.y2;
    s.x2 = s.x1;
    s.x1 = x;
    s.y2 = s.y1;
    s.y1 = y;
    return y;
  }
  void process(float* x, int n, const Params& p) {
    if (p.deessFreq != coefFreq) {
      const double w = 2 * kPi * p.deessFreq / kRate, cs = std::cos(w), alpha = std::sin(w) / (2 * 0.7071), a0 = 1 + alpha;
      a1 = (-2 * cs) / a0;
      a2 = (1 - alpha) / a0;
      hb0 = (1 + cs) / 2 / a0;
      hb1 = -(1 + cs) / a0;
      lb0 = (1 - cs) / 2 / a0;
      lb1 = (1 - cs) / a0;
      coefFreq = p.deessFreq;
    }
    const double thr = dbToLin(p.deessThr), maxCut = dbToLin(-p.deessAmt);
    const double aCoef = std::exp(-1.0 / (kRate * 0.0008)), rCoef = std::exp(-1.0 / (kRate * 0.03));
    for (int i = 0; i < n; i++) {
      const double in = x[i];
      const double high = bq(hp2, bq(hp1, in, hb0, hb1, a1, a2), hb0, hb1, a1, a2);
      const double low = bq(lp2, bq(lp1, in, lb0, lb1, a1, a2), lb0, lb1, a1, a2);
      const double a = std::fabs(high);
      env = a > env ? a + (env - a) * aCoef : a + (env - a) * rCoef;
      double target = 1;
      if (p.deessOn && env > thr) target = std::max(maxCut, thr / env);
      const double c = target < gain ? aCoef : rCoef;
      gain = target + (gain - target) * c;
      x[i] = (float)(low + high * gain);
    }
  }
};

// ---------- clarity (clarity-processor.js): lifts consonants and word onsets in 1.2-4.5 kHz ----------
struct Clarity {
  Biquad hp, lp;
  double fast = 0, slow = 0, gain = 1;
  bool ready = false;
  static void band(Biquad& b, double f, bool high) {
    const double w = 2 * kPi * f / kRate, c = std::cos(w), alpha = std::sin(w) / (2 * 0.7071), a0 = 1 + alpha;
    if (high) b.set((1 + c) / 2, -(1 + c), (1 + c) / 2, a0, -2 * c, 1 - alpha);
    else b.set((1 - c) / 2, (1 - c), (1 - c) / 2, a0, -2 * c, 1 - alpha);
  }
  void process(float* x, int n, const Params& p) {
    if (!ready) {
      band(hp, 1200, true);
      band(lp, 4500, false);
      ready = true;
    }
    const double amount = p.clarityOn ? p.clarityAmt / 100.0 : 0.0;
    const double fa = std::exp(-1.0 / (kRate * 0.0005)), fr = std::exp(-1.0 / (kRate * 0.012));
    const double sa = std::exp(-1.0 / (kRate * 0.025)), sr = std::exp(-1.0 / (kRate * 0.1));
    const double ga = std::exp(-1.0 / (kRate * 0.001)), gr = std::exp(-1.0 / (kRate * 0.012));
    const double eps = 2e-4;
    for (int i = 0; i < n; i++) {
      const double in = x[i];
      const double b = lp.process(hp.process(in));
      const double a = std::fabs(b);
      fast = a > fast ? a + (fast - a) * fa : a + (fast - a) * fr;
      slow = a > slow ? a + (slow - a) * sa : a + (slow - a) * sr;
      const double rise = 20 * std::log10((fast + eps) / (slow + eps)) / 6;
      const double onset = std::min(1.0, std::max(0.0, rise));
      const double target = std::pow(10.0, amount * (2 + 6 * onset) / 20);
      gain = target + (gain - target) * (target > gain ? ga : gr);
      x[i] = (float)(in + b * (gain - 1));
    }
  }
};

// ---------- compressor (compressor-processor.js): soft knee, no hidden makeup ----------
struct Compressor {
  double env = 1e-6, grDb = 0, makeupDb = 0;
  void process(float* x, int n, const Params& p) {
    const double knee = 6, slope = 1.0 / p.compRatio - 1;
    const double aCoef = std::exp(-1.0 / (kRate * p.compAtk)), rCoef = std::exp(-1.0 / (kRate * p.compRel));
    const double makeupTarget = p.compOn ? p.makeup : 0;
    const double mCoef = std::exp(-1.0 / (kRate * 0.02)), detRelease = std::exp(-1.0 / (kRate * 0.03));
    for (int i = 0; i < n; i++) {
      const double a = std::fabs((double)x[i]);
      env = a > env ? a : a + (env - a) * detRelease;
      const double levelDb = 20 * std::log10(std::max(env, 1e-6));
      double targetGr = 0;
      if (p.compOn) {
        const double over = levelDb - p.compThr;
        if (knee > 0 && 2 * std::fabs(over) <= knee) {
          const double t = over + knee / 2;
          targetGr = (slope * t * t) / (2 * knee);
        } else if (over > 0) {
          targetGr = slope * over;
        }
      }
      const double c = targetGr < grDb ? aCoef : rCoef;
      grDb = targetGr + (grDb - targetGr) * c;
      makeupDb = makeupTarget + (makeupDb - makeupTarget) * mCoef;
      x[i] = (float)(x[i] * std::pow(10.0, (grDb + makeupDb) / 20));
    }
  }
};

// ---------- blown-out mic (blown-processor.js) ----------
struct Blown {
  double hpState = 0, hpPrev = 0, held = 0, lp1 = 0, lp2 = 0, toneFreq = 0, lpCoef = 0;
  long counter = 0;
  void process(float* x, int n, const Params& p) {
    if (!p.lofiOn) return;
    const double drive = dbToLin(p.lofiDrive);
    const double step = std::pow(2.0, 1 - std::round(p.lofiBits));
    const long hold = std::max(1L, (long)std::lround(p.lofiHold));
    const double level = dbToLin(p.lofiLevel);
    if (p.lofiTone != toneFreq) {
      toneFreq = p.lofiTone;
      lpCoef = 1 - std::exp((-2 * kPi * p.lofiTone) / kRate);
    }
    const double hpCoef = std::exp((-2 * kPi * 250) / kRate);
    for (int i = 0; i < n; i++) {
      hpState = hpCoef * (hpState + x[i] - hpPrev);
      hpPrev = x[i];
      double v = hpState * drive;
      v = v > 1 ? 1 : v < -1 ? -1 : v;
      if (counter++ % hold == 0) held = std::round(v / step) * step;
      lp1 += lpCoef * (held - lp1);
      lp2 += lpCoef * (lp1 - lp2);
      x[i] = (float)(lp2 * level);
    }
  }
};

// ---------- lookahead limiter (limiter-processor.js) ----------
struct Limiter {
  static constexpr int kLook = 96;
  static constexpr int kSize = kLook + 1;
  float delay[kSize] = {0}, targets[kSize], mins[kSize];
  int pos = 0;
  double sum = kSize, held = 1;
  double minGain = 1;
  Limiter() {
    for (int i = 0; i < kSize; i++) targets[i] = mins[i] = 1;
  }
  void process(float* x, int n, const Params& p) {
    const double ceil = dbToLin(p.limCeil), rCoef = std::exp(-1.0 / (kRate * 0.08));
    for (int i = 0; i < n; i++) {
      const int q = pos;
      const double a = std::fabs((double)x[i]);
      targets[q] = (float)(p.limOn && a > ceil ? ceil / a : 1);
      delay[q] = x[i];
      double wmin = 1;
      for (int k = 0; k < kSize; k++)
        if (targets[k] < wmin) wmin = targets[k];
      held = wmin < held ? wmin : wmin + (held - wmin) * rCoef;
      const double old = mins[q];
      mins[q] = (float)held;
      sum += held - old;
      const double gain = sum / kSize;
      pos = q + 1 == kSize ? 0 : q + 1;
      x[i] = (float)(delay[pos] * gain);
      if (gain < minGain) minGain = gain;
    }
  }
};

// ---------- RNNoise (neural noise suppression), port of renderer/rnnoise-processor.js ----------
// RNNoise works on 10 ms frames (480 samples at 48 kHz) of 16-bit-range floats, so this adds one frame of
// latency while on. The dry signal is delayed by the same frame so wet and dry stay aligned.
class Denoise {
 public:
  Denoise() : state_(rnnoise_create(nullptr)) {}
  ~Denoise() {
    if (state_) rnnoise_destroy(state_);
  }
  Denoise(const Denoise&) = delete;
  Denoise& operator=(const Denoise&) = delete;

  // Switching on starts with one silent frame (the delayed wet path has nothing yet), exactly as the web
  // worklet does, so the two engines behave the same. It is a 10 ms gap at the moment of the switch.
  void process(float* x, int n, bool on, double wet = 1.0) {
    if (!on || !state_) {
      if (active_) reset_();
      return;
    }
    active_ = true;
    for (int i = 0; i < n; i++) {
      const int p = fill_;
      const float y = (float)(prevRaw_[p] * (1 - wet) + outBuf_[p] * wet);
      inBuf_[p] = x[i];
      x[i] = y;
      if (++fill_ == kFrame) {
        fill_ = 0;
        frame_();
      }
    }
  }

 private:
  static constexpr int kFrame = 480;
  static constexpr float kScale = 32768.f;

  void frame_() {
    float in[kFrame], out[kFrame];
    for (int i = 0; i < kFrame; i++) in[i] = inBuf_[i] * kScale;
    rnnoise_process_frame(state_, out, in);
    for (int i = 0; i < kFrame; i++) outBuf_[i] = out[i] / kScale;
    std::memcpy(prevRaw_, inBuf_, sizeof(prevRaw_));
  }
  // Start clean next time instead of replaying stale audio.
  void reset_() {
    fill_ = 0;
    std::memset(inBuf_, 0, sizeof(inBuf_));
    std::memset(prevRaw_, 0, sizeof(prevRaw_));
    std::memset(outBuf_, 0, sizeof(outBuf_));
    active_ = false;
  }

  DenoiseState* state_;
  float inBuf_[kFrame] = {}, prevRaw_[kFrame] = {}, outBuf_[kFrame] = {};
  int fill_ = 0;
  bool active_ = false;
};

// ---------- the whole voice chain ----------
struct Meters {
  float inDb = -100, outDb = -100, grDb = 0, gate = 1, limiterGain = 1;
};

class Chain {
 public:
  // The first call applies instantly; later ones glide like the Web Audio param ramps.
  void setParams(const Params& p, bool immediate = false) {
    target_ = p;
    if (immediate || first_) snap_();
    first_ = false;
  }
  void setMuted(bool m) { muted_ = m; }
  // While the delay test runs, its click must pass untouched: RNNoise would remove it as noise, and a closed
  // gate or a muted output would hide it. None of these stages adds delay of its own (RNNoise's 10 ms is added back).
  void setMeasuring(bool b) { measuring_ = b; }
  const Meters& meters() const { return meters_; }
  double inLevelDb() const { return meters_.inDb; }

  // Processes `n` mono samples. `extra` (optional) is added just before the limiter, like the
  // soundboard and desktop buses in the web engine. n may be any size.
  void process(const float* in, float* out, int n, const float* extra = nullptr) {
    for (int off = 0; off < n; off += kMaxBlock) {
      const int m = std::min(kMaxBlock, n - off);
      block_(in + off, out + off, m, extra ? extra + off : nullptr);
    }
  }

 private:
  void snap_() {
    cur_ = target_;
    inG_ = dbToLin(cur_.inGain);
    outG_ = muted_ ? 0 : dbToLin(cur_.outGain);
    eq_[0] = target_.eqOn ? target_.eqLow : 0;
    eq_[1] = target_.eqOn ? target_.eqMud : 0;
    eq_[2] = target_.eqOn ? target_.eqPres : 0;
    eq_[3] = target_.eqOn ? target_.eqAir : 0;
    hpf_ = target_.hpfOn ? target_.hpfFreq : 10;
  }

  void block_(const float* in, float* out, int n, const float* extra) {
    const double glide = 1 - std::exp(-(double)n / (kRate * 0.015));
    const bool silent = muted_ && !measuring_.load(std::memory_order_relaxed);
    const double tInG = dbToLin(target_.inGain), tOutG = silent ? 0 : dbToLin(target_.outGain);
    inG_ += (tInG - inG_) * glide;
    outG_ += (tOutG - outG_) * glide;
    const double tEq[4] = {target_.eqOn ? target_.eqLow : 0, target_.eqOn ? target_.eqMud : 0,
                           target_.eqOn ? target_.eqPres : 0, target_.eqOn ? target_.eqAir : 0};
    for (int i = 0; i < 4; i++) eq_[i] += (tEq[i] - eq_[i]) * glide;
    hpf_ += ((target_.hpfOn ? target_.hpfFreq : 10) - hpf_) * glide;
    cur_ = target_;  // non-glided stages read the target directly

    hp_.highpass(hpf_, 0.707);
    low_.lowShelf(120, eq_[0]);
    mud_.peaking(300, 1.0, eq_[1]);
    pres_.peaking(3500, 0.9, eq_[2]);
    air_.highShelf(10000, eq_[3]);

    float* x = out;
    double inPeak = 0;
    for (int i = 0; i < n; i++) {
      x[i] = (float)(in[i] * inG_);
      inPeak = std::max(inPeak, std::fabs((double)x[i]));
    }
    for (int i = 0; i < n; i++) x[i] = (float)hp_.process(x[i]);
    dn_.process(x, n, cur_.nsOn && !measuring_.load(std::memory_order_relaxed), cur_.nsAmt / 100.0);
    if (!measuring_.load(std::memory_order_relaxed)) gate_.process(x, n, cur_);
    for (int i = 0; i < n; i++) {
      double v = x[i];
      v = low_.process(v);
      v = mud_.process(v);
      v = pres_.process(v);
      v = air_.process(v);
      x[i] = (float)v;
    }
    deess_.process(x, n, cur_);
    comp_.process(x, n, cur_);
    clarity_.process(x, n, cur_);
    blown_.process(x, n, cur_);
    if (extra)
      for (int i = 0; i < n; i++) x[i] += extra[i];
    lim_.process(x, n, cur_);
    double outPeak = 0;
    for (int i = 0; i < n; i++) {
      x[i] = (float)(x[i] * outG_);
      outPeak = std::max(outPeak, std::fabs((double)x[i]));
    }
    meters_.inDb = inPeak > 0 ? (float)(20 * std::log10(inPeak)) : -100.f;
    meters_.outDb = outPeak > 0 ? (float)(20 * std::log10(outPeak)) : -100.f;
    meters_.grDb = (float)comp_.grDb;
    meters_.gate = (float)gate_.gain;
  }

  Params target_, cur_;
  bool first_ = true, muted_ = false;
  std::atomic<bool> measuring_{false};
  double inG_ = 1, outG_ = 1, hpf_ = 80, eq_[4] = {0, 0, 0, 0};
  Biquad hp_, low_, mud_, pres_, air_;
  Denoise dn_;
  Gate gate_;
  DeEsser deess_;
  Compressor comp_;
  Clarity clarity_;
  Blown blown_;
  Limiter lim_;
  Meters meters_;
};

}  // namespace vf
