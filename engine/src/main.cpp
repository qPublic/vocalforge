// VocalForge native audio engine.
//
//   engine.exe                     control mode: JSON lines on stdin/stdout (used by the Electron app)
//   engine.exe --backend null      same, with miniaudio's null backend (no hardware; used by tests)
//   engine.exe --process-raw IN OUT [PARAMS.json]   offline: run raw float32 mono 48 kHz through the chain
//   engine.exe --defaults          print the default settings as JSON
//   engine.exe --devices           print the audio devices as JSON
//
// Audio runs on miniaudio's own threads; the control thread only changes atomics or locks briefly.

#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <fcntl.h>
#include <io.h>

#define MA_NO_ENCODING
#define MA_NO_GENERATION
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_NODE_GRAPH
#define MA_NO_ENGINE
#define MA_ENABLE_ONLY_SPECIFIC_BACKENDS
#define MA_ENABLE_WASAPI
#define MA_ENABLE_NULL
#define MINIAUDIO_IMPLEMENTATION
#include "../third_party/miniaudio.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "dsp.h"
#include "params.h"

namespace vf {

constexpr const char* kVersion = "0.1.0";

// ---------- output to the Electron app ----------
std::mutex g_outMutex;

void emit(const json& j) {
  const std::string line = j.dump(-1, ' ', false, json::error_handler_t::replace) + "\n";
  std::lock_guard<std::mutex> lock(g_outMutex);
  fwrite(line.data(), 1, line.size(), stdout);
  fflush(stdout);
}

void emitError(const std::string& message, const json& id = nullptr) {
  json j = {{"event", "error"}, {"message", message}};
  if (!id.is_null()) j["id"] = id;
  emit(j);
}

// ---------- helpers ----------
std::wstring utf8ToWide(const std::string& s) {
  if (s.empty()) return L"";
  const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
  std::wstring w(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), &w[0], n);
  return w;
}

// Device ids are fixed-size structs that are mostly zero padding, so the trailing zeros are dropped
// when encoding and restored when decoding.
std::string hexEncode(const void* data, size_t len) {
  static const char* d = "0123456789abcdef";
  const unsigned char* p = (const unsigned char*)data;
  while (len > 0 && p[len - 1] == 0) len--;
  std::string out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    out += d[p[i] >> 4];
    out += d[p[i] & 15];
  }
  return out;
}

bool hexDecode(const std::string& s, void* out, size_t len) {
  if (s.size() % 2 != 0 || s.size() > len * 2) return false;
  auto v = [](char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; };
  memset(out, 0, len);
  for (size_t i = 0; i < s.size() / 2; i++) {
    const int hi = v(s[2 * i]), lo = v(s[2 * i + 1]);
    if (hi < 0 || lo < 0) return false;
    ((unsigned char*)out)[i] = (unsigned char)(hi * 16 + lo);
  }
  return true;
}

// Single-producer single-consumer ring of mono float samples.
class Ring {
 public:
  explicit Ring(size_t capacityPow2 = 1 << 15) : buf_(capacityPow2), mask_(capacityPow2 - 1) {}
  size_t size() const { return w_.load(std::memory_order_acquire) - r_.load(std::memory_order_acquire); }
  size_t push(const float* x, size_t n) {
    const size_t w = w_.load(std::memory_order_relaxed), r = r_.load(std::memory_order_acquire);
    n = std::min(n, buf_.size() - (w - r));
    for (size_t i = 0; i < n; i++) buf_[(w + i) & mask_] = x[i];
    w_.store(w + n, std::memory_order_release);
    return n;
  }
  size_t pop(float* x, size_t n) {
    const size_t r = r_.load(std::memory_order_relaxed), w = w_.load(std::memory_order_acquire);
    n = std::min(n, w - r);
    for (size_t i = 0; i < n; i++) x[i] = buf_[(r + i) & mask_];
    r_.store(r + n, std::memory_order_release);
    return n;
  }
  void skip(size_t n) {
    const size_t r = r_.load(std::memory_order_relaxed), w = w_.load(std::memory_order_acquire);
    r_.store(r + std::min(n, w - r), std::memory_order_release);
  }
  void clear() { r_.store(w_.load()); }

 private:
  std::vector<float> buf_;
  size_t mask_;
  std::atomic<size_t> w_{0}, r_{0};
};

// Reads a ring that another device clock fills in whole periods. The two clocks drift and jitter, so a block can
// arrive a little late; a cushion beyond one block absorbs that. When the ring does run dry the cushion grows (up
// to about 40 ms), the gap is faded rather than cut, and the audio resumes only once the cushion is rebuilt.
class Feed {
 public:
  void reset(Ring* ring, uint32_t base) {
    ring_ = ring;
    base_ = cushion_ = base;
    primed_ = false;
    clean_ = fadeIn_ = 0;
  }
  void unprime() { primed_ = false; }
  uint32_t cushion() const { return cushion_; }
  // Fills dst with m samples (zeros where the ring had nothing). Returns true if it ran dry.
  bool pull(float* dst, size_t m) {
    const size_t avail = ring_->size(), need = m + cushion_;
    if (!primed_ && avail >= need) {
      primed_ = true;
      fadeIn_ = kFade;
    }
    size_t got = 0;
    bool dry = false;
    if (primed_) {
      if (avail > need + std::max<size_t>(m, base_) * 4) ring_->skip(avail - need);  // stay close to live
      got = ring_->pop(dst, m);
      if (got < m) {
        dry = true;
        primed_ = false;
        clean_ = 0;
        cushion_ = std::min<uint32_t>(cushion_ + 96, std::max<uint32_t>(base_ * 4, 1920));
        const size_t f = std::min<size_t>(got, kFade);
        for (size_t i = 0; i < f; i++) dst[got - 1 - i] *= (float)i / (float)f;  // fade out into the gap
      } else if ((clean_ += (uint32_t)m) > 48000u * 30 && cushion_ > base_) {
        cushion_ = std::max<uint32_t>(base_, cushion_ - 48);  // calm for 30 s: give some latency back
        clean_ = 48000u * 20;
      }
      for (size_t i = 0; i < got && fadeIn_ > 0; i++, fadeIn_--) dst[i] *= 1.0f - (float)fadeIn_ / (float)kFade;
    }
    for (size_t i = got; i < m; i++) dst[i] = 0;
    return dry;
  }

 private:
  static constexpr uint32_t kFade = 64;
  Ring* ring_ = nullptr;
  uint32_t base_ = 240, cushion_ = 240, clean_ = 0, fadeIn_ = 0;
  bool primed_ = false;
};

struct Clip {
  std::vector<float> samples;  // mono, 48 kHz
};
struct Voice {
  std::shared_ptr<const Clip> clip;
  size_t pos = 0;
  float gain = 1.f;  // per-clip volume, never above full scale
};

// ---------- the engine ----------
class Engine {
 public:
  explicit Engine(std::string backend) : backend_(std::move(backend)) {}
  ~Engine() {
    stop();
    if (ctxReady_) ma_context_uninit(&ctx_);
  }

  json devices(std::string& err) {
    if (!initContext(err)) return nullptr;
    ma_device_info *pb = nullptr, *cap = nullptr;
    ma_uint32 pbN = 0, capN = 0;
    if (ma_context_get_devices(&ctx_, &pb, &pbN, &cap, &capN) != MA_SUCCESS) {
      err = "Could not list audio devices";
      return nullptr;
    }
    auto list = [](ma_device_info* info, ma_uint32 count) {
      json a = json::array();
      a.push_back({{"deviceId", "default"}, {"label", "Default device"}, {"isDefault", true}});
      for (ma_uint32 i = 0; i < count; i++)
        a.push_back({{"deviceId", hexEncode(&info[i].id, sizeof(ma_device_id))}, {"label", info[i].name}, {"isDefault", info[i].isDefault != 0}});
      return a;
    };
    return {{"inputs", list(cap, capN)}, {"outputs", list(pb, pbN)}};
  }

  // Windows' shared mode runs at 10 ms. Asking a device for less makes some drivers (a USB headset here) hand out
  // 7 ms periods and deliver about 4% fewer samples than real time, which starves the mixer about once a second.
  // So the buffer setting is the cushion in the mic ring, never the device period.
  ma_uint32 devicePeriod() const { return std::max<ma_uint32>(frames_, 480); }

  bool start(const json& c, std::string& err) {
    stop();
    if (!initContext(err)) return false;
    frames_ = (ma_uint32)std::min<int64_t>(2048, std::max<int64_t>(64, c.value("bufferFrames", 240)));
    ma_device_id idIn{}, idOut{}, idMon{};
    const bool hasIn = parseId(c.value("input", "default"), idIn, err), hasOut = parseId(c.value("output", "default"), idOut, err);
    if (!err.empty()) return false;
    const json mon = c.contains("monitor") && c["monitor"].is_object() ? c["monitor"] : json::object();
    monitorOn_ = mon.value("on", false);
    const bool hasMon = monitorOn_ && parseId(mon.value("device", "default"), idMon, err);
    if (!err.empty()) return false;

    micRing_.clear();
    monRing_.clear();
    deskRing_.clear();
    micFeed_.reset(&micRing_, frames_);
    monFeed_.reset(&monRing_, frames_);
    outputId_ = hasOut ? idOut : ma_device_id{};
    outputIsDefault_ = !hasOut;

    ma_device_config cc = ma_device_config_init(ma_device_type_capture);
    cc.capture.format = ma_format_f32;
    cc.capture.channels = 1;
    cc.capture.pDeviceID = hasIn ? &idIn : nullptr;
    cc.sampleRate = kRate;
    cc.periodSizeInFrames = devicePeriod();
    cc.performanceProfile = ma_performance_profile_low_latency;
    cc.dataCallback = captureThunk;
    cc.pUserData = this;
    if (ma_device_init(&ctx_, &cc, &capture_) != MA_SUCCESS) {
      err = "Could not open the microphone";
      return false;
    }
    captureInit_ = true;

    if (!initPlayback(hasOut ? &idOut : nullptr, err)) {
      stop();
      return false;
    }

    if (monitorOn_) {
      ma_device_config mc = ma_device_config_init(ma_device_type_playback);
      mc.playback.format = ma_format_f32;
      mc.playback.channels = 2;
      mc.playback.pDeviceID = hasMon ? &idMon : nullptr;
      mc.sampleRate = kRate;
      mc.periodSizeInFrames = devicePeriod();
      mc.performanceProfile = ma_performance_profile_low_latency;
      mc.dataCallback = monitorThunk;
      mc.pUserData = this;
      if (ma_device_init(&ctx_, &mc, &monitor_) != MA_SUCCESS) {
        err = "Could not open the monitor device";
        stop();
        return false;
      }
      monitorInit_ = true;
    }

    running_ = true;
    if (ma_device_start(&capture_) != MA_SUCCESS || ma_device_start(&playback_) != MA_SUCCESS || (monitorInit_ && ma_device_start(&monitor_) != MA_SUCCESS)) {
      err = "Could not start audio";
      stop();
      return false;
    }
    if (desktopWanted_) startLoopback(err);  // best effort: a desktop-audio failure should not block the mic

    const double cap = (double)capture_.capture.internalPeriodSizeInFrames * capture_.capture.internalPeriods / std::max<ma_uint32>(1, capture_.sampleRate);
    const double pl = (double)playback_.playback.internalPeriodSizeInFrames * playback_.playback.internalPeriods / std::max<ma_uint32>(1, playback_.sampleRate);
    latencyMs_ = (float)((cap + pl) * 1000.0 + Limiter::kLook * 1000.0 / kRate);
    detail_ = {{"captureFrames", capture_.capture.internalPeriodSizeInFrames}, {"capturePeriods", capture_.capture.internalPeriods},
               {"playbackFrames", playback_.playback.internalPeriodSizeInFrames}, {"playbackPeriods", playback_.playback.internalPeriods},
               {"rate", capture_.sampleRate}};
    meterStop_ = false;
    meterThread_ = std::thread([this] { meterLoop(); });
    return true;
  }

  void stop() {
    abortMeasure();
    {
      std::lock_guard<std::mutex> lock(meterMutex_);
      meterStop_ = true;
    }
    meterCv_.notify_all();
    if (meterThread_.joinable()) meterThread_.join();
    running_ = false;
    if (captureInit_) ma_device_uninit(&capture_);
    if (playbackInit_) ma_device_uninit(&playback_);
    if (monitorInit_) ma_device_uninit(&monitor_);
    stopLoopback();
    captureInit_ = playbackInit_ = monitorInit_ = false;
    clearVoices_ = true;
    {
      std::lock_guard<std::mutex> lock(voiceMutex_);
      pendingVoices_.clear();
    }
  }

  bool running() const { return running_; }
  float latencyMs() const { return latencyMs_; }

  // Measures the delay from the effects chain input to the output device. A short click is injected at the
  // chain input and timed until it shows up in a loopback capture of the output device, three times over.
  // The mic's own buffering is not part of this and is estimated separately. It runs on its own thread, so
  // other commands (stop, mute, settings) are not held up; the result arrives later as a "measured" event.
  bool startMeasure(const json& id, std::string& err) {
    if (!running_) {
      err = "Start the mixer first";
      return false;
    }
    if (backend_ == "null") {
      err = "Measuring needs a real audio device";
      return false;
    }
    if (measureBusy_.exchange(true)) {
      err = "A measurement is already running";
      return false;
    }
    if (measureThread_.joinable()) measureThread_.join();
    measureAbort_ = false;
    measureThread_ = std::thread([this, id] {
      std::string e;
      json r = runMeasure(e);
      if (e.empty()) {
        r["event"] = "measured";
        if (!id.is_null()) r["id"] = id;
        emit(r);
      } else {
        emitError(e, id);
      }
      measureBusy_ = false;
    });
    return true;
  }

  void abortMeasure() {
    measureAbort_ = true;
    if (measureThread_.joinable()) measureThread_.join();
    measureBusy_ = false;
  }

  json runMeasure(std::string& err) {
    ma_device_config lc = ma_device_config_init(ma_device_type_loopback);
    lc.capture.format = ma_format_f32;
    lc.capture.channels = 2;
    lc.capture.pDeviceID = outputIsDefault_ ? nullptr : &outputId_;
    lc.sampleRate = kRate;
    lc.dataCallback = measureThunk;
    lc.pUserData = this;
    ma_device dev{};
    if (ma_device_init(&ctx_, &lc, &dev) != MA_SUCCESS) {
      err = "Could not listen to the output device";
      return json();
    }
    measureArmed_ = false;
    measureBaseline_ = 0.0f;
    if (ma_device_start(&dev) != MA_SUCCESS) {
      ma_device_uninit(&dev);
      err = "Could not start listening to the output device";
      return json();
    }
    chain_.setMeasuring(true);
    auto nap = [&](int ms) {
      for (int t = 0; t < ms && !measureAbort_.load(); t += 10) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    };
    nap(300);  // let the loopback settle

    std::vector<double> ms;
    bool noisy = false;
    for (int trial = 0; trial < 3 && !measureAbort_.load(); trial++) {
      // Whatever else is playing on that output right now would be mistaken for the click.
      measureBaseline_ = 0.0f;
      nap(150);
      const float base = measureBaseline_.load();
      if (base > 0.05f) {
        noisy = true;
        break;
      }
      measureThreshold_ = std::max(0.01f, base * 3.0f);
      measureDetectNs_ = 0;
      measureT0Ns_ = 0;
      measureArmed_ = true;
      measureInject_ = true;
      for (int waited = 0; waited < 80 && measureDetectNs_.load() == 0 && !measureAbort_.load(); waited++) std::this_thread::sleep_for(std::chrono::milliseconds(10));
      measureArmed_ = false;
      const long long t1 = measureDetectNs_.load(), t0 = measureT0Ns_.load();
      if (t1 > 0 && t0 > 0 && t1 > t0) ms.push_back((double)(t1 - t0) / 1e6);
      nap(350);
    }
    chain_.setMeasuring(false);
    measureInject_ = false;
    ma_device_uninit(&dev);

    if (measureAbort_.load()) {
      err = "The measurement was cancelled";
      return json();
    }
    if (noisy) {
      err = "Something else is playing on that output. Pause it and try again.";
      return json();
    }
    if (ms.empty()) {
      err = "The click never came back. Is the output device muted?";
      return json();
    }
    std::sort(ms.begin(), ms.end());
    const double median = ms[ms.size() / 2];
    const double ns = nsOn_.load() ? 10.0 : 0.0;
    const double inputMs = capture_.capture.internalPeriodSizeInFrames * 1000.0 / std::max<ma_uint32>(1, capture_.sampleRate) + frames_ * 1000.0 / kRate;
    json samples = json::array();
    for (double v : ms) samples.push_back(std::round(v * 10) / 10);
    return {{"outputMs", std::round((median + ns) * 10) / 10}, {"inputMs", std::round(inputMs * 10) / 10},
            {"minMs", std::round((ms.front() + ns) * 10) / 10}, {"maxMs", std::round((ms.back() + ns) * 10) / 10},
            {"noiseSuppressionMs", ns}, {"trials", (int)ms.size()}, {"samples", samples}};
  }
  const json& detail() const { return detail_; }

  void setValues(const json& values) {
    std::lock_guard<std::mutex> lock(paramsMutex_);
    applyValues(pending_, values);
    nsOn_ = pending_.nsOn;
    dirty_ = true;
  }
  void setMuted(bool m) { muted_ = m; }
  void setBoardDb(double db) { boardLin_ = (float)dbToLin(std::min(0.0, std::max(-60.0, db))); }
  void setDesktopDb(double db) { deskLin_ = (float)dbToLin(std::min(6.0, std::max(-60.0, db))); }
  void stopSounds() { clearVoices_ = true; }

  bool setDesktop(bool on, std::string& err) {
    desktopWanted_ = on;
    if (!running_) return true;
    if (on) return startLoopback(err);
    stopLoopback();
    return true;
  }

  // Switches the output device without touching the microphone.
  bool setOutput(const std::string& id, std::string& err) {
    ma_device_id dev{};
    const bool has = parseId(id, dev, err);
    if (!err.empty()) return false;
    if (!running_) {
      outputId_ = has ? dev : ma_device_id{};
      outputIsDefault_ = !has;
      return true;
    }
    if (playbackInit_) {
      ma_device_uninit(&playback_);
      playbackInit_ = false;
    }
    micFeed_.unprime();
    if (!initPlayback(has ? &dev : nullptr, err)) return false;
    if (ma_device_start(&playback_) != MA_SUCCESS) {
      err = "Could not start the new output";
      return false;
    }
    return true;
  }

  bool play(const std::string& path, double gainDb, std::string& err) {
    if (!running_) {
      err = "Start the mixer first";
      return false;
    }
    std::shared_ptr<const Clip> clip;
    auto it = clips_.find(path);
    if (it != clips_.end()) clip = it->second;
    else {
      clip = loadClip(path, err);
      if (!clip) return false;
      clips_[path] = clip;
    }
    std::lock_guard<std::mutex> lock(voiceMutex_);
    pendingVoices_.push_back(Voice{clip, 0, (float)dbToLin(std::min(0.0, std::max(-40.0, gainDb)))});
    return true;
  }

 private:
  // ----- setup -----
  bool initContext(std::string& err) {
    if (ctxReady_) return true;
    ma_backend backends[1] = {backend_ == "null" ? ma_backend_null : ma_backend_wasapi};
    ma_context_config cc = ma_context_config_init();
    if (ma_context_init(backends, 1, &cc, &ctx_) != MA_SUCCESS) {
      err = "Could not start the audio system";
      return false;
    }
    ctxReady_ = true;
    return true;
  }

  // Returns true when `id` names a specific device (written to `out`); false for the default device.
  // Sets `err` for an unreadable id.
  static bool parseId(const std::string& id, ma_device_id& out, std::string& err) {
    if (id.empty() || id == "default") return false;
    if (!hexDecode(id, &out, sizeof(ma_device_id))) err = "Unknown audio device id";
    return err.empty();
  }

  bool initPlayback(const ma_device_id* id, std::string& err) {
    ma_device_config pc = ma_device_config_init(ma_device_type_playback);
    pc.playback.format = ma_format_f32;
    pc.playback.channels = 2;
    pc.playback.pDeviceID = id;
    pc.sampleRate = kRate;
    pc.periodSizeInFrames = devicePeriod();
    pc.performanceProfile = ma_performance_profile_low_latency;
    pc.dataCallback = playbackThunk;
    pc.pUserData = this;
    if (ma_device_init(&ctx_, &pc, &playback_) != MA_SUCCESS) {
      err = "Could not open the output device";
      return false;
    }
    playbackInit_ = true;
    return true;
  }

  bool startLoopback(std::string& err) {
    if (loopbackInit_) return true;
    if (backend_ == "null") return true;  // loopback capture only exists on WASAPI
    ma_device_config lc = ma_device_config_init(ma_device_type_loopback);
    lc.capture.format = ma_format_f32;
    lc.capture.channels = 2;
    lc.sampleRate = kRate;
    lc.dataCallback = loopbackThunk;
    lc.pUserData = this;
    if (ma_device_init(&ctx_, &lc, &loopback_) != MA_SUCCESS) {
      err = "Could not capture desktop audio";
      return false;
    }
    loopbackInit_ = true;
    deskRing_.clear();
    if (ma_device_start(&loopback_) != MA_SUCCESS) {
      ma_device_uninit(&loopback_);
      loopbackInit_ = false;
      err = "Could not start desktop audio capture";
      return false;
    }
    return true;
  }

  void stopLoopback() {
    if (!loopbackInit_) return;
    ma_device_uninit(&loopback_);
    loopbackInit_ = false;
  }

  std::shared_ptr<const Clip> loadClip(const std::string& path, std::string& err) {
    ma_decoder_config dc = ma_decoder_config_init(ma_format_f32, 1, kRate);
    ma_decoder dec;
    if (ma_decoder_init_file_w(utf8ToWide(path).c_str(), &dc, &dec) != MA_SUCCESS) {
      err = "Could not open or decode that sound file";
      return nullptr;
    }
    auto clip = std::make_shared<Clip>();
    std::vector<float> tmp(4096);
    for (;;) {
      ma_uint64 got = 0;
      ma_decoder_read_pcm_frames(&dec, tmp.data(), tmp.size(), &got);
      if (got == 0) break;
      clip->samples.insert(clip->samples.end(), tmp.begin(), tmp.begin() + (size_t)got);
      if (clip->samples.size() > (size_t)kRate * 120) break;  // two minutes is plenty for a soundboard clip
    }
    ma_decoder_uninit(&dec);
    if (clip->samples.empty()) {
      err = "That sound file is empty";
      return nullptr;
    }
    return clip;
  }

  // ----- audio callbacks -----
  static void captureThunk(ma_device* d, void*, const void* in, ma_uint32 n) { ((Engine*)d->pUserData)->onCapture((const float*)in, n); }
  static void playbackThunk(ma_device* d, void* out, const void*, ma_uint32 n) { ((Engine*)d->pUserData)->onPlayback((float*)out, n); }
  static void monitorThunk(ma_device* d, void* out, const void*, ma_uint32 n) { ((Engine*)d->pUserData)->onMonitor((float*)out, n); }
  static void loopbackThunk(ma_device* d, void*, const void* in, ma_uint32 n) { ((Engine*)d->pUserData)->onLoopback((const float*)in, n); }
  static void measureThunk(ma_device* d, void*, const void* in, ma_uint32 n) { ((Engine*)d->pUserData)->onMeasure((const float*)in, n); }

  void onCapture(const float* in, ma_uint32 n) {
    if (!running_ || !in) return;
    if (micRing_.push(in, n) < n) overruns_++;
  }

  // Loopback of the output device while measuring: note when the injected click first appears.
  static long long nowNs() { return std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
  void onMeasure(const float* in, ma_uint32 n) {
    if (!in) return;
    if (!measureArmed_.load()) {
      float peak = measureBaseline_.load();
      for (ma_uint32 i = 0; i < 2 * n; i++) peak = std::max(peak, std::fabs(in[i]));
      measureBaseline_ = peak;
      return;
    }
    if (measureT0Ns_.load() == 0 || measureDetectNs_.load() != 0) return;
    const float threshold = measureThreshold_.load();
    for (ma_uint32 i = 0; i < n; i++) {
      if (std::fabs(in[2 * i]) > threshold || std::fabs(in[2 * i + 1]) > threshold) {
        // The callback runs when the block has just been captured, so the click was (n - i) frames ago.
        measureDetectNs_ = nowNs() - (long long)((double)(n - i) * 1e9 / kRate);
        return;
      }
    }
  }

  void onLoopback(const float* in, ma_uint32 n) {
    if (!running_ || !in) return;
    float mono[kMaxBlock];
    for (ma_uint32 off = 0; off < n; off += kMaxBlock) {
      const ma_uint32 m = std::min<ma_uint32>(kMaxBlock, n - off);
      for (ma_uint32 i = 0; i < m; i++) mono[i] = 0.5f * (in[2 * (off + i)] + in[2 * (off + i) + 1]);
      deskRing_.push(mono, m);
    }
  }

  void onMonitor(float* out, ma_uint32 n) {
    float mono[kMaxBlock];
    for (ma_uint32 off = 0; off < n; off += kMaxBlock) {
      const ma_uint32 m = std::min<ma_uint32>(kMaxBlock, n - off);
      if (monFeed_.pull(mono, m)) monUnderruns_++;
      for (ma_uint32 i = 0; i < m; i++) out[2 * (off + i)] = out[2 * (off + i) + 1] = mono[i];
    }
  }

  void onPlayback(float* out, ma_uint32 n) {
    // Pick up new settings without ever blocking the audio thread.
    if (dirty_.load(std::memory_order_acquire) && paramsMutex_.try_lock()) {
      chain_.setParams(pending_);
      dirty_ = false;
      paramsMutex_.unlock();
    }
    chain_.setMuted(muted_);
    if (clearVoices_.exchange(false)) voices_.clear();
    if (voiceMutex_.try_lock()) {
      for (auto& v : pendingVoices_) {
        if (voices_.size() >= 16) voices_.erase(voices_.begin());
        voices_.push_back(v);
      }
      pendingVoices_.clear();
      voiceMutex_.unlock();
    }

    static thread_local float mic[kMaxBlock], extra[kMaxBlock], desk[kMaxBlock], mono[kMaxBlock];
    for (ma_uint32 off = 0; off < n; off += kMaxBlock) {
      const ma_uint32 m = std::min<ma_uint32>(kMaxBlock, n - off);

      // Microphone, through a cushion so the two device clocks can drift without constant dropouts.
      if (micFeed_.pull(mic, m)) underruns_++;
      micCushion_ = micFeed_.cushion();
      if (off == 0 && measureInject_.exchange(false)) {
        // A 3 ms burst of 1 kHz at about -6 dBFS enters at the start of this block.
        measureT0Ns_ = nowNs();
        for (int i = 0; i < 144 && i < (int)m; i++) mic[i] += 0.5f * (float)std::sin(2.0 * kPi * 1000.0 * i / kRate) * (float)std::sin(kPi * i / 144.0);
      }

      // Buses that join just before the limiter: soundboard voices and desktop audio.
      std::fill(extra, extra + m, 0.0f);
      const float bl = boardLin_;
      for (size_t v = 0; v < voices_.size();) {
        Voice& vo = voices_[v];
        const auto& s = vo.clip->samples;
        ma_uint32 i = 0;
        for (; i < m && vo.pos < s.size(); i++, vo.pos++) extra[i] += s[vo.pos] * bl * vo.gain;
        if (vo.pos >= s.size()) voices_.erase(voices_.begin() + v);
        else v++;
      }
      if (loopbackInit_) {
        const size_t dGot = deskRing_.pop(desk, m);
        const float dl = deskLin_;
        for (size_t i = 0; i < dGot; i++) extra[i] += desk[i] * dl;
        if (deskRing_.size() > (size_t)frames_ * 20) deskRing_.skip(deskRing_.size() - (size_t)frames_ * 4);
      }

      chain_.process(mic, mono, (int)m, extra);
      for (ma_uint32 i = 0; i < m; i++) out[2 * (off + i)] = out[2 * (off + i) + 1] = mono[i];
      if (monitorOn_) monRing_.push(mono, m);

      const Meters& mt = chain_.meters();
      meterIn_ = mt.inDb;
      meterOut_ = mt.outDb;
      meterGr_ = mt.grDb;
      meterGate_ = mt.gate;
    }
  }

  void meterLoop() {
    std::unique_lock<std::mutex> lock(meterMutex_);
    while (!meterStop_) {
      meterCv_.wait_for(lock, std::chrono::milliseconds(50));
      if (meterStop_) break;
      emit({{"event", "meters"}, {"in", meterIn_.load()}, {"out", meterOut_.load()}, {"gr", meterGr_.load()}, {"gate", meterGate_.load()},
            {"latencyMs", latencyMs_.load() + (nsOn_.load() ? 10.f : 0.f)}, {"underruns", underruns_.load()}, {"monUnderruns", monUnderruns_.load()}, {"micCushion", micCushion_.load()}, {"overruns", overruns_.load()}});
    }
  }

  std::string backend_;
  ma_context ctx_{};
  bool ctxReady_ = false;
  ma_device capture_{}, playback_{}, monitor_{}, loopback_{};
  std::thread measureThread_;
  std::atomic<bool> measureArmed_{false}, measureInject_{false}, measureBusy_{false}, measureAbort_{false};
  std::atomic<long long> measureT0Ns_{0}, measureDetectNs_{0};
  std::atomic<float> measureBaseline_{0.0f}, measureThreshold_{0.01f};
  bool captureInit_ = false, playbackInit_ = false, monitorInit_ = false, loopbackInit_ = false;
  ma_uint32 frames_ = 240;
  ma_device_id outputId_{};
  bool outputIsDefault_ = true;
  std::atomic<bool> running_{false}, monitorOn_{false}, desktopWanted_{false}, muted_{false}, clearVoices_{false};
  std::atomic<float> boardLin_{0.2512f}, deskLin_{0.5f};
  json detail_;  // what the devices actually negotiated, for diagnostics
  std::atomic<float> latencyMs_{0};
  std::atomic<bool> nsOn_{false};  // RNNoise holds one 10 ms frame while it is on
  Feed micFeed_, monFeed_;
  std::atomic<uint32_t> underruns_{0}, overruns_{0}, monUnderruns_{0}, micCushion_{0};

  Ring micRing_{1 << 15}, monRing_{1 << 15}, deskRing_{1 << 16};

  Chain chain_;
  Params pending_;
  std::mutex paramsMutex_;
  std::atomic<bool> dirty_{true};

  std::vector<Voice> voices_;  // audio thread only
  std::vector<Voice> pendingVoices_;
  std::mutex voiceMutex_;
  std::map<std::string, std::shared_ptr<const Clip>> clips_;  // control thread only

  std::atomic<float> meterIn_{-100}, meterOut_{-100}, meterGr_{0}, meterGate_{1};
  std::thread meterThread_;
  std::mutex meterMutex_;
  std::condition_variable meterCv_;
  bool meterStop_ = false;
};

// ---------- offline processing (used by parity tests) ----------
int runOffline(const std::string& inPath, const std::string& outPath, const std::string& paramsPath) {
  std::ifstream in(inPath, std::ios::binary);
  if (!in) {
    fprintf(stderr, "cannot read %s\n", inPath.c_str());
    return 2;
  }
  std::vector<char> raw((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  std::vector<float> x(raw.size() / sizeof(float));
  if (!x.empty()) memcpy(x.data(), raw.data(), x.size() * sizeof(float));

  Params p;
  if (!paramsPath.empty()) {
    std::ifstream pf(paramsPath);
    json j = json::parse(pf, nullptr, false);
    if (j.is_discarded()) {
      fprintf(stderr, "bad params json\n");
      return 2;
    }
    applyValues(p, j.contains("values") ? j["values"] : j);
  }
  Chain chain;
  chain.setParams(p, true);
  std::vector<float> y(x.size());
  for (size_t off = 0; off < x.size(); off += 128) chain.process(x.data() + off, y.data() + off, (int)std::min<size_t>(128, x.size() - off));

  std::ofstream out(outPath, std::ios::binary);
  out.write((const char*)y.data(), y.size() * sizeof(float));
  return out ? 0 : 2;
}

// ---------- control protocol ----------
void handle(Engine& engine, const json& j, bool& quit) {
  const json id = j.contains("id") ? j["id"] : json(nullptr);
  auto reply = [&](json r) {
    if (!id.is_null()) r["id"] = id;
    emit(r);
  };
  if (!j.is_object() || !j.contains("cmd") || !j["cmd"].is_string()) return emitError("Missing cmd", id);
  const std::string cmd = j["cmd"];
  std::string err;

  if (cmd == "hello") {
    reply({{"event", "hello"}, {"version", kVersion}});
  } else if (cmd == "devices") {
    json d = engine.devices(err);
    if (!err.empty()) return emitError(err, id);
    d["event"] = "devices";
    reply(d);
  } else if (cmd == "start") {
    if (!engine.start(j, err)) return emitError(err, id);
    reply({{"event", "started"}, {"latencyMs", engine.latencyMs()}, {"devices", engine.detail()}});
  } else if (cmd == "stop") {
    engine.stop();
    reply({{"event", "stopped"}});
  } else if (cmd == "set") {
    engine.setValues(j.value("values", json::object()));
    if (!id.is_null()) reply({{"event", "ok"}});
  } else if (cmd == "mute") {
    engine.setMuted(j.value("on", false));
  } else if (cmd == "boardLevel") {
    engine.setBoardDb(j.value("db", -12.0));
  } else if (cmd == "desktopLevel") {
    engine.setDesktopDb(j.value("db", -6.0));
  } else if (cmd == "desktop") {
    if (j.contains("db")) engine.setDesktopDb(j.value("db", -6.0));
    if (!engine.setDesktop(j.value("on", false), err)) return emitError(err, id);
    if (!id.is_null()) reply({{"event", "ok"}});
  } else if (cmd == "output") {
    if (!engine.setOutput(j.value("device", "default"), err)) return emitError(err, id);
    reply({{"event", "ok"}});
  } else if (cmd == "play") {
    const double gainDb = j.contains("gain") && j["gain"].is_number() ? j["gain"].get<double>() : 0.0;
    if (!engine.play(j.value("path", ""), gainDb, err)) return emitError(err, id);
    reply({{"event", "played"}});
  } else if (cmd == "measure") {
    if (!engine.startMeasure(id, err)) return emitError(err, id);  // the result is sent later, from the measuring thread
  } else if (cmd == "stopSounds") {
    engine.stopSounds();
  } else if (cmd == "quit") {
    quit = true;
  } else {
    emitError("Unknown command: " + cmd, id);
  }
}

int runControl(const std::string& backend) {
  Engine engine(backend);
  emit({{"event", "ready"}, {"version", kVersion}, {"backend", backend}});
  std::string line;
  bool quit = false;
  while (!quit && std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty()) continue;
    json j = json::parse(line, nullptr, false);
    if (j.is_discarded()) {
      emitError("Invalid JSON");
      continue;
    }
    try {
      handle(engine, j, quit);
    } catch (const std::exception& e) {
      emitError(std::string("Command failed: ") + e.what(), j.is_object() && j.contains("id") ? j["id"] : json(nullptr));
    }
  }
  engine.stop();
  return 0;
}

}  // namespace vf

int main(int argc, char** argv) {
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
  std::string backend = "wasapi";
  std::vector<std::string> args(argv + 1, argv + argc);
  for (size_t i = 0; i + 1 < args.size(); i++)
    if (args[i] == "--backend") backend = args[i + 1];

  for (size_t i = 0; i < args.size(); i++) {
    if (args[i] == "--version") {
      printf("%s\n", vf::kVersion);
      return 0;
    }
    if (args[i] == "--defaults") {
      printf("%s\n", vf::toJson(vf::Params()).dump().c_str());
      return 0;
    }
    if (args[i] == "--devices") {
      vf::Engine engine(backend);
      std::string err;
      vf::json d = engine.devices(err);
      if (!err.empty()) {
        fprintf(stderr, "%s\n", err.c_str());
        return 1;
      }
      printf("%s\n", d.dump().c_str());
      return 0;
    }
    if (args[i] == "--process-raw") {
      if (i + 2 >= args.size()) {
        fprintf(stderr, "usage: --process-raw IN OUT [PARAMS.json]\n");
        return 2;
      }
      return vf::runOffline(args[i + 1], args[i + 2], i + 3 < args.size() && args[i + 3].rfind("--", 0) != 0 ? args[i + 3] : "");
    }
  }
  return vf::runControl(backend);
}
