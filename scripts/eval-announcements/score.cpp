// Scores the announcement rules against gold labels, and says how sure the numbers are.
//
//   g++ -O2 -std=c++17 -o score score.cpp
//   ./score events.txt [--compare before.txt] [--resamples 5000] [--seed 2026] [--json]
//
// events.txt is written by export.ts: per announcement, its half ("dev" or "test"), the gold events and the
// events the rules suggested. No announcement text is in it. C++17, standard library only.
//
// An event is (kind, day); the day may be absent when the text names none. Per announcement the events are a
// set, so one said twice counts once. Three levels, each stricter than the one before:
//
//   kind      which kinds of event the announcement holds, whatever the day
//   date      which events, each with its day, the rules settled on
//   assisted  the same, where a day the rules left open counts as right when the right day was among the
//             choices they offered
//
// Precision, recall and F1 are pooled over the announcements of a half. The 95% interval is a percentile
// bootstrap over announcements, not sentences or events: the unit that was sampled when the half was chosen is
// the announcement, and the events in one announcement are not independent of each other.
//
// With --compare before.txt (the same announcements scored with an earlier version of the rules) it also gives
// the change in F1 with its own interval. The two versions are resampled together, announcement by
// announcement, so the interval is for the difference, not two overlapping intervals read by eye.
//
// The random numbers are std::mt19937_64 reduced with %, so a seed gives the same intervals on any platform.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <map>
#include <random>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace {

const double kNone = std::nan("");
const std::array<const char *, 3> kLevels = {"kind", "date", "assisted"};

struct Event {
  std::string kind;
  std::string date;  // empty when the text names no day
  std::vector<std::string> choices;
};

struct Announcement {
  std::string split;
  std::vector<Event> gold;
  std::vector<Event> predicted;
};

struct Counts {
  long tp = 0, fp = 0, fn = 0;
};

using Row = std::array<Counts, 3>;

std::string key(const Event &e) { return e.kind + "|" + (e.date.empty() ? "null" : e.date); }

bool has(const std::vector<std::string> &list, const std::string &item) {
  return std::find(list.begin(), list.end(), item) != list.end();
}

// Multiset match: true positives, false positives, false negatives.
Counts match(const std::vector<std::string> &predicted, const std::vector<std::string> &gold) {
  std::map<std::string, long> left;
  for (const auto &item : gold) left[item] += 1;
  Counts counts;
  for (const auto &item : predicted) {
    auto found = left.find(item);
    if (found != left.end() && found->second > 0) {
      counts.tp += 1;
      found->second -= 1;
    }
  }
  counts.fp = static_cast<long>(predicted.size()) - counts.tp;
  counts.fn = static_cast<long>(gold.size()) - counts.tp;
  return counts;
}

Row score_one(const Announcement &a) {
  std::vector<std::string> predicted_keys, gold_keys;
  std::set<std::string> predicted_kinds, gold_kinds;
  for (const auto &e : a.predicted) {
    predicted_keys.push_back(key(e));
    predicted_kinds.insert(e.kind);
  }
  for (const auto &e : a.gold) {
    gold_keys.push_back(key(e));
    gold_kinds.insert(e.kind);
  }

  // A day left open counts as right when the right day is among the choices offered, and is not already
  // suggested as an event of its own.
  std::vector<std::string> assisted;
  for (const auto &event : a.predicted) {
    if (!event.date.empty()) {
      assisted.push_back(key(event));
      continue;
    }
    const Event *hit = nullptr;
    for (const auto &g : a.gold) {
      if (g.kind == event.kind && !g.date.empty() && has(event.choices, g.date) && !has(predicted_keys, key(g))) {
        hit = &g;
        break;
      }
    }
    assisted.push_back(hit ? key(*hit) : key(event));
  }

  Row row;
  row[0] = match({predicted_kinds.begin(), predicted_kinds.end()}, {gold_kinds.begin(), gold_kinds.end()});
  row[1] = match(predicted_keys, gold_keys);
  row[2] = match(assisted, gold_keys);
  return row;
}

struct Rates {
  double precision, recall, f1;
};

Rates rates(const Counts &c) {
  Rates r{kNone, kNone, kNone};
  if (c.tp + c.fp > 0) r.precision = static_cast<double>(c.tp) / static_cast<double>(c.tp + c.fp);
  if (c.tp + c.fn > 0) r.recall = static_cast<double>(c.tp) / static_cast<double>(c.tp + c.fn);
  if (!std::isnan(r.precision) && !std::isnan(r.recall) && r.precision + r.recall > 0) {
    r.f1 = 2 * r.precision * r.recall / (r.precision + r.recall);
  }
  return r;
}

Counts pooled(const std::vector<Row> &rows, size_t level, const std::vector<size_t> *picks = nullptr) {
  Counts total;
  auto add = [&](const Row &row) {
    total.tp += row[level].tp;
    total.fp += row[level].fp;
    total.fn += row[level].fn;
  };
  if (picks) {
    for (size_t i : *picks) add(rows[i]);
  } else {
    for (const auto &row : rows) add(row);
  }
  return total;
}

// Linear-interpolated percentile of an already sorted list.
double percentile(const std::vector<double> &sorted, double q) {
  if (sorted.size() == 1) return sorted[0];
  double position = q * static_cast<double>(sorted.size() - 1);
  size_t lower = static_cast<size_t>(position);
  size_t upper = std::min(lower + 1, sorted.size() - 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - static_cast<double>(lower));
}

uint64_t seed_of(const std::string &text) {  // FNV-1a, 64 bits
  uint64_t h = 1469598103934665603ULL;
  for (unsigned char c : text) {
    h ^= c;
    h *= 1099511628211ULL;
  }
  return h;
}

struct Interval {
  bool known = false;
  double low = 0, high = 0;
};

Interval interval_of(std::vector<double> &values, size_t resamples) {
  Interval out;
  // An interval over fewer than half the resamples says too little to be worth printing.
  if (values.size() * 2 < resamples || values.empty()) return out;
  std::sort(values.begin(), values.end());
  out.known = true;
  out.low = percentile(values, 0.025);
  out.high = percentile(values, 0.975);
  return out;
}

struct LevelResult {
  Counts counts;
  Rates rates;
  Interval precision, recall, f1;
};

struct Change {
  bool known = false;
  double before = kNone, after = kNone, change = kNone;
  Interval ci;
  double share_better = kNone;
};

struct PartResult {
  size_t announcements = 0;
  long gold_events = 0;
  std::array<LevelResult, 3> levels;
  std::array<Change, 3> vs_before;
  bool has_before = false;
};

LevelResult bootstrap(const std::vector<Row> &rows, size_t level, size_t resamples, std::mt19937_64 &rng) {
  LevelResult out;
  out.counts = pooled(rows, level);
  out.rates = rates(out.counts);
  std::vector<double> p, r, f;
  std::vector<size_t> picks(rows.size());
  for (size_t n = 0; n < resamples; ++n) {
    for (auto &pick : picks) pick = static_cast<size_t>(rng() % rows.size());
    Rates sample = rates(pooled(rows, level, &picks));
    if (!std::isnan(sample.precision)) p.push_back(sample.precision);
    if (!std::isnan(sample.recall)) r.push_back(sample.recall);
    if (!std::isnan(sample.f1)) f.push_back(sample.f1);
  }
  out.precision = interval_of(p, resamples);
  out.recall = interval_of(r, resamples);
  out.f1 = interval_of(f, resamples);
  return out;
}

// Change in pooled F1, after minus before, with a 95% interval from resampling announcements together.
Change paired_change(const std::vector<Row> &after, const std::vector<Row> &before, size_t level, size_t resamples, std::mt19937_64 &rng) {
  Change out;
  out.after = rates(pooled(after, level)).f1;
  out.before = rates(pooled(before, level)).f1;
  if (std::isnan(out.after) || std::isnan(out.before)) return out;
  out.known = true;
  out.change = out.after - out.before;
  std::vector<double> changes;
  std::vector<size_t> picks(after.size());
  for (size_t n = 0; n < resamples; ++n) {
    for (auto &pick : picks) pick = static_cast<size_t>(rng() % after.size());
    double a = rates(pooled(after, level, &picks)).f1;
    double b = rates(pooled(before, level, &picks)).f1;
    if (!std::isnan(a) && !std::isnan(b)) changes.push_back(a - b);
  }
  if (!changes.empty()) {
    size_t better = static_cast<size_t>(std::count_if(changes.begin(), changes.end(), [](double c) { return c > 0; }));
    out.share_better = static_cast<double>(better) / static_cast<double>(changes.size());
  }
  out.ci = interval_of(changes, resamples);
  return out;
}

// --- reading events.txt ---------------------------------------------------------------------------------------
//   A <split>
//   G <kind> <day|->
//   P <kind> <day|-> <choice,choice,...|->
std::vector<Announcement> read_events(const std::string &path) {
  std::ifstream in(path);
  if (!in) {
    std::cerr << "cannot read " << path << "\n";
    std::exit(2);
  }
  std::vector<Announcement> out;
  std::string line;
  while (std::getline(in, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty() || line[0] == '#') continue;
    std::istringstream words(line);
    std::string tag;
    words >> tag;
    if (tag == "A") {
      Announcement a;
      words >> a.split;
      out.push_back(a);
    } else if ((tag == "G" || tag == "P") && !out.empty()) {
      Event e;
      std::string day, choices;
      words >> e.kind >> day;
      if (day != "-") e.date = day;
      if (tag == "P") {
        words >> choices;
        if (!choices.empty() && choices != "-") {
          std::istringstream parts(choices);
          std::string one;
          while (std::getline(parts, one, ',')) e.choices.push_back(one);
        }
        out.back().predicted.push_back(e);
      } else {
        out.back().gold.push_back(e);
      }
    } else {
      std::cerr << "unreadable line in " << path << ": " << line << "\n";
      std::exit(2);
    }
  }
  return out;
}

bool same_events(const std::vector<Event> &a, const std::vector<Event> &b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) {
    if (a[i].kind != b[i].kind || a[i].date != b[i].date) return false;
  }
  return true;
}

// --- output ---------------------------------------------------------------------------------------------------
std::string pct(double v) {
  if (std::isnan(v)) return "n/a";
  char buf[32];
  std::snprintf(buf, sizeof buf, "%.1f%%", v * 100);
  return buf;
}

std::string bracket(const Interval &ci, bool signed_values = false) {
  if (!ci.known) return "";
  char buf[64];
  std::snprintf(buf, sizeof buf, signed_values ? " [%+.1f, %+.1f]" : " [%.1f, %.1f]", ci.low * 100, ci.high * 100);
  return buf;
}

std::string num(double v) {
  if (std::isnan(v)) return "null";
  char buf[40];
  std::snprintf(buf, sizeof buf, "%.17g", v);
  return buf;
}

std::string json_interval(const Interval &ci) { return ci.known ? "[" + num(ci.low) + ", " + num(ci.high) + "]" : "null"; }

void print_json(const std::map<std::string, PartResult> &result) {
  std::cout << "{";
  bool first_part = true;
  for (const auto &[part, entry] : result) {
    std::cout << (first_part ? "" : ",") << "\"" << part << "\":{\"announcements\":" << entry.announcements << ",\"goldEvents\":" << entry.gold_events << ",\"levels\":{";
    first_part = false;
    for (size_t l = 0; l < 3; ++l) {
      const auto &r = entry.levels[l];
      std::cout << (l ? "," : "") << "\"" << kLevels[l] << "\":{\"tp\":" << r.counts.tp << ",\"fp\":" << r.counts.fp << ",\"fn\":" << r.counts.fn
                << ",\"precision\":" << num(r.rates.precision) << ",\"recall\":" << num(r.rates.recall) << ",\"f1\":" << num(r.rates.f1)
                << ",\"ci95\":{\"precision\":" << json_interval(r.precision) << ",\"recall\":" << json_interval(r.recall) << ",\"f1\":" << json_interval(r.f1) << "}}";
    }
    std::cout << "}";
    if (entry.has_before) {
      std::cout << ",\"vsBefore\":{";
      for (size_t l = 0; l < 3; ++l) {
        const auto &c = entry.vs_before[l];
        std::cout << (l ? "," : "") << "\"" << kLevels[l] << "\":{\"before\":" << num(c.before) << ",\"after\":" << num(c.after) << ",\"change\":" << num(c.change)
                  << ",\"ci95\":" << json_interval(c.ci) << ",\"shareBetter\":" << num(c.share_better) << "}";
      }
      std::cout << "}";
    }
    std::cout << "}";
  }
  std::cout << "}\n";
}

void print_text(const std::map<std::string, PartResult> &result, size_t resamples, long seed) {
  for (const auto &[part, entry] : result) {
    std::printf("\n%s: %zu announcements, %ld gold events\n", part.c_str(), entry.announcements, entry.gold_events);
    for (size_t l = 0; l < 3; ++l) {
      const auto &r = entry.levels[l];
      std::printf("  %-9s precision %s%s   recall %s%s   F1 %s%s   (tp %ld, fp %ld, fn %ld)\n", kLevels[l], pct(r.rates.precision).c_str(),
                  bracket(r.precision).c_str(), pct(r.rates.recall).c_str(), bracket(r.recall).c_str(), pct(r.rates.f1).c_str(), bracket(r.f1).c_str(),
                  r.counts.tp, r.counts.fp, r.counts.fn);
    }
    if (entry.has_before) {
      for (size_t l = 0; l < 3; ++l) {
        const auto &c = entry.vs_before[l];
        if (!c.known) continue;
        std::printf("  %-9s F1 %s -> %s   change %+.1f points%s   better in %.1f%% of resamples\n", kLevels[l], pct(c.before).c_str(), pct(c.after).c_str(),
                    c.change * 100, bracket(c.ci, true).c_str(), c.share_better * 100);
      }
    }
  }
  std::printf("\n95%% intervals: percentile bootstrap over announcements, %zu resamples, seed %ld.\n", resamples, seed);
}

}  // namespace

int main(int argc, char **argv) {
  std::string events_path, before_path;
  size_t resamples = 5000;
  long seed = 2026;
  bool as_json = false;
  for (int i = 1; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--compare" && i + 1 < argc) before_path = argv[++i];
    else if (arg == "--resamples" && i + 1 < argc) resamples = static_cast<size_t>(std::strtoul(argv[++i], nullptr, 10));
    else if (arg == "--seed" && i + 1 < argc) seed = std::strtol(argv[++i], nullptr, 10);
    else if (arg == "--json") as_json = true;
    else if (!arg.empty() && arg[0] != '-' && events_path.empty()) events_path = arg;
    else {
      std::cerr << "usage: score events.txt [--compare before.txt] [--resamples N] [--seed N] [--json]\n";
      return 2;
    }
  }
  if (events_path.empty() || resamples == 0) {
    std::cerr << "usage: score events.txt [--compare before.txt] [--resamples N] [--seed N] [--json]\n";
    return 2;
  }

  std::vector<Announcement> data = read_events(events_path);
  std::vector<Announcement> before;
  if (!before_path.empty()) {
    before = read_events(before_path);
    bool same = before.size() == data.size();
    for (size_t i = 0; same && i < data.size(); ++i) same = before[i].split == data[i].split && same_events(before[i].gold, data[i].gold);
    if (!same) {
      std::cerr << "--compare: the two files are not the same announcements with the same gold labels\n";
      return 2;
    }
  }

  std::map<std::string, PartResult> result;
  for (const char *part : {"dev", "test"}) {
    std::vector<Row> rows, prior;
    PartResult entry;
    for (size_t i = 0; i < data.size(); ++i) {
      if (data[i].split != part) continue;
      rows.push_back(score_one(data[i]));
      entry.gold_events += static_cast<long>(data[i].gold.size());
      if (!before_path.empty()) prior.push_back(score_one(before[i]));
    }
    entry.announcements = rows.size();
    if (!rows.empty()) {
      for (size_t l = 0; l < 3; ++l) {
        // One generator per half and level, so a half's interval does not depend on the others.
        std::string stem = std::to_string(seed) + ":" + part + ":" + kLevels[l];
        std::mt19937_64 rng(seed_of(stem));
        entry.levels[l] = bootstrap(rows, l, resamples, rng);
        if (!before_path.empty()) {
          std::mt19937_64 paired(seed_of(stem + ":paired"));
          entry.vs_before[l] = paired_change(rows, prior, l, resamples, paired);
        }
      }
      entry.has_before = !before_path.empty();
    }
    result[part] = entry;
  }

  if (as_json) print_json(result);
  else print_text(result, resamples, seed);
  return 0;
}
