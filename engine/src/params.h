// Voice-chain settings. Ids and defaults match PARAMS in renderer/engine.js (a test keeps them in sync).
#pragma once
#include <algorithm>
#include "../third_party/json.hpp"

namespace vf {

using json = nlohmann::json;

struct Params {
  double inGain = 0;
  bool hpfOn = true;
  double hpfFreq = 80;
  bool nsOn = false;
  double nsAmt = 100;
  bool gateOn = true;
  double gateThr = -52, gateRel = 0.18;
  bool levelOn = false;
  double levelTarget = -22, levelRange = 9;
  bool clickOn = false;
  double clickAmt = 60;
  bool eqOn = true;
  double eqLow = 2, eqMud = -2.5, eqPres = 3, eqAir = 2;
  bool deessOn = true;
  double deessFreq = 5500, deessThr = -32, deessAmt = 8;
  bool compOn = true;
  double compThr = -22, compRatio = 3, compAtk = 0.008, compRel = 0.2, makeup = 8;
  bool lofiOn = false;
  double lofiDrive = 26, lofiBits = 9, lofiHold = 3, lofiTone = 5500, lofiLevel = -4;
  bool clarityOn = false;
  double clarityAmt = 40;
  bool duckOn = false;
  double duckAmt = 9, duckThr = -45, duckRel = 0.6;
  bool limOn = true;
  double limCeil = -1.5;
  double outGain = 0;
};

struct Field {
  const char* name;
  double Params::*num;
  bool Params::*flag;
  double lo, hi;
};

// Values come from outside the process, so every number is clamped to its slider range.
inline const Field* fields(size_t& count) {
  static const Field table[] = {
      {"inGain", &Params::inGain, nullptr, -20, 30},
      {"hpfOn", nullptr, &Params::hpfOn, 0, 0},
      {"hpfFreq", &Params::hpfFreq, nullptr, 20, 300},
      {"nsOn", nullptr, &Params::nsOn, 0, 0},
      {"nsAmt", &Params::nsAmt, nullptr, 0, 100},
      {"gateOn", nullptr, &Params::gateOn, 0, 0},
      {"gateThr", &Params::gateThr, nullptr, -90, -10},
      {"gateRel", &Params::gateRel, nullptr, 0.02, 1},
      {"levelOn", nullptr, &Params::levelOn, 0, 0},
      {"levelTarget", &Params::levelTarget, nullptr, -36, -10},
      {"levelRange", &Params::levelRange, nullptr, 0, 18},
      {"clickOn", nullptr, &Params::clickOn, 0, 0},
      {"clickAmt", &Params::clickAmt, nullptr, 0, 100},
      {"eqOn", nullptr, &Params::eqOn, 0, 0},
      {"eqLow", &Params::eqLow, nullptr, -12, 12},
      {"eqMud", &Params::eqMud, nullptr, -12, 6},
      {"eqPres", &Params::eqPres, nullptr, -6, 12},
      {"eqAir", &Params::eqAir, nullptr, -6, 12},
      {"deessOn", nullptr, &Params::deessOn, 0, 0},
      {"deessFreq", &Params::deessFreq, nullptr, 3000, 10000},
      {"deessThr", &Params::deessThr, nullptr, -60, -10},
      {"deessAmt", &Params::deessAmt, nullptr, 0, 18},
      {"compOn", nullptr, &Params::compOn, 0, 0},
      {"compThr", &Params::compThr, nullptr, -60, 0},
      {"compRatio", &Params::compRatio, nullptr, 1, 20},
      {"compAtk", &Params::compAtk, nullptr, 0.001, 0.1},
      {"compRel", &Params::compRel, nullptr, 0.05, 1},
      {"makeup", &Params::makeup, nullptr, 0, 24},
      {"lofiOn", nullptr, &Params::lofiOn, 0, 0},
      {"lofiDrive", &Params::lofiDrive, nullptr, 0, 50},
      {"lofiBits", &Params::lofiBits, nullptr, 3, 16},
      {"lofiHold", &Params::lofiHold, nullptr, 1, 16},
      {"lofiTone", &Params::lofiTone, nullptr, 1500, 16000},
      {"lofiLevel", &Params::lofiLevel, nullptr, -24, 6},
      {"clarityOn", nullptr, &Params::clarityOn, 0, 0},
      {"clarityAmt", &Params::clarityAmt, nullptr, 0, 100},
      {"duckOn", nullptr, &Params::duckOn, 0, 0},
      {"duckAmt", &Params::duckAmt, nullptr, 0, 24},
      {"duckThr", &Params::duckThr, nullptr, -70, -20},
      {"duckRel", &Params::duckRel, nullptr, 0.2, 2},
      {"limOn", nullptr, &Params::limOn, 0, 0},
      {"limCeil", &Params::limCeil, nullptr, -12, 0},
      {"outGain", &Params::outGain, nullptr, -30, 12},
  };
  count = sizeof(table) / sizeof(table[0]);
  return table;
}

// Applies the keys present in `values` (a JSON object); unknown keys and wrong types are ignored.
inline void applyValues(Params& p, const json& values) {
  if (!values.is_object()) return;
  size_t n = 0;
  const Field* f = fields(n);
  for (size_t i = 0; i < n; i++) {
    auto it = values.find(f[i].name);
    if (it == values.end()) continue;
    if (f[i].num && it->is_number()) {
      double v = it->get<double>();
      if (v == v) p.*(f[i].num) = std::min(f[i].hi, std::max(f[i].lo, v));
    } else if (f[i].flag && it->is_boolean()) {
      p.*(f[i].flag) = it->get<bool>();
    }
  }
}

inline json toJson(const Params& p) {
  json j = json::object();
  size_t n = 0;
  const Field* f = fields(n);
  for (size_t i = 0; i < n; i++) j[f[i].name] = f[i].num ? json(p.*(f[i].num)) : json(p.*(f[i].flag));
  return j;
}

}  // namespace vf
