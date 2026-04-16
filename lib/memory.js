import fs from "fs";
import path from "path";

const memoryFilePath = path.join(process.cwd(), "data", "user-memory.json");

const DEFAULT_PROFILE = {
  price_sensitive: false,
  needs_color: false,
  needs_note_taking: false,
  needs_waterproof: false,
  prefers_lightweight: false,
  main_usage: [],
  interested_models: [],
  rejected_models: [],
  compared_targets: [],
  last_recommendation: "",
};

function ensureMemoryFile() {
  if (!fs.existsSync(memoryFilePath)) {
    fs.writeFileSync(memoryFilePath, "{}", "utf-8");
  }
}

function readMemoryStore() {
  ensureMemoryFile();
  const raw = fs.readFileSync(memoryFilePath, "utf-8");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function writeMemoryStore(store) {
  fs.writeFileSync(memoryFilePath, JSON.stringify(store, null, 2), "utf-8");
}

export function getUserProfile(visitorId) {
  if (!visitorId) return { ...DEFAULT_PROFILE };

  const store = readMemoryStore();
  return {
    ...DEFAULT_PROFILE,
    ...(store[visitorId]?.profile || {}),
  };
}

export function saveUserProfile(visitorId, profile) {
  if (!visitorId) return;

  const store = readMemoryStore();
  store[visitorId] = {
    profile,
    updatedAt: new Date().toISOString(),
  };
  writeMemoryStore(store);
}

function addUnique(arr, value) {
  if (!value) return arr;
  if (arr.includes(value)) return arr;
  return [...arr, value];
}

export function extractPreferencesFromMessage(message) {
  const text = String(message || "").toLowerCase();
  const patch = {};

  if (
    text.includes("预算") ||
    text.includes("便宜") ||
    text.includes("性价比") ||
    text.includes("不想太贵")
  ) {
    patch.price_sensitive = true;
  }

  if (text.includes("彩色") || text.includes("漫画") || text.includes("图文")) {
    patch.needs_color = true;
  }

  if (
    text.includes("手写") ||
    text.includes("笔记") ||
    text.includes("批注")
  ) {
    patch.needs_note_taking = true;
  }

  if (text.includes("不需要手写") || text.includes("不用笔记")) {
    patch.needs_note_taking = false;
  }

  if (text.includes("防水")) {
    patch.needs_waterproof = true;
  }

  if (text.includes("轻") || text.includes("便携") || text.includes("通勤")) {
    patch.prefers_lightweight = true;
  }

  const usage = [];

  if (text.includes("小说") || text.includes("文学")) usage.push("novel");
  if (text.includes("漫画")) usage.push("comic");
  if (text.includes("pdf")) usage.push("pdf");
  if (text.includes("英文") || text.includes("英语")) usage.push("english");
  if (text.includes("学习")) usage.push("study");
  if (text.includes("杂志")) usage.push("magazine");
  if (text.includes("儿童")) usage.push("kids");

  if (usage.length > 0) {
    patch.main_usage = usage;
  }

  const interestedModels = [];
  if (text.includes("paperwhite")) interestedModels.push("Paperwhite");
  if (text.includes("colorsoft")) interestedModels.push("Colorsoft");
  if (text.includes("scribe")) interestedModels.push("Scribe");
  if (text.includes("oasis")) interestedModels.push("Oasis");
  if (text.includes("基础版")) interestedModels.push("Kindle 基础版");

  if (interestedModels.length > 0) {
    patch.interested_models = interestedModels;
  }

  return patch;
}

export function mergeProfile(oldProfile, patch) {
  const next = {
    ...oldProfile,
    ...patch,
  };

  if (patch.main_usage) {
    next.main_usage = [...new Set([...(oldProfile.main_usage || []), ...patch.main_usage])];
  }

  if (patch.interested_models) {
    next.interested_models = [...new Set([...(oldProfile.interested_models || []), ...patch.interested_models])];
  }

  if (patch.rejected_models) {
    next.rejected_models = [...new Set([...(oldProfile.rejected_models || []), ...patch.rejected_models])];
  }

  if (patch.compared_targets) {
    next.compared_targets = [...new Set([...(oldProfile.compared_targets || []), ...patch.compared_targets])];
  }

  return next;
}

export function buildPersonalizedRecommendation(profile, kb) {
  const models = kb.models || [];
  if (!models.length) return null;

  const scored = models.map((model) => {
    let score = 0;
    const name = model.name || "";
    const bestFor = model.best_for || "";
    const highlights = (model.highlights || []).join(" ");
    const colors = (model.colors || []).join(" ");
    const text = `${name} ${bestFor} ${highlights} ${colors}`.toLowerCase();

    if (profile.price_sensitive) {
      if (text.includes("预算") || text.includes("性价比") || name.includes("Kindle（2024）") || name.includes("Paperwhite")) {
        score += 2;
      }
      if (name.includes("Scribe Colorsoft")) score -= 2;
    }

    if (profile.needs_color) {
      if (text.includes("彩色") || name.toLowerCase().includes("colorsoft")) score += 3;
      else score -= 1;
    }

    if (profile.needs_note_taking) {
      if (name.toLowerCase().includes("scribe")) score += 3;
      else score -= 1;
    }

    if (profile.needs_waterproof) {
      if (model.waterproof_ipx) score += 2;
      else score -= 1;
    }

    if (profile.prefers_lightweight) {
      if ((model.weight_g || 999) <= 220) score += 2;
      if ((model.weight_g || 999) >= 350) score -= 2;
    }

    if ((profile.main_usage || []).includes("comic")) {
      if (text.includes("漫画") || text.includes("彩色")) score += 2;
    }

    if ((profile.main_usage || []).includes("pdf")) {
      if (name.toLowerCase().includes("scribe")) score += 2;
      if ((model.display?.size_inch || 0) >= 7) score += 1;
    }

    if ((profile.main_usage || []).includes("novel")) {
      if (name.includes("Paperwhite") || name.includes("Kindle（2024）")) score += 2;
    }

    if ((profile.interested_models || []).some((x) => name.includes(x))) {
      score += 1;
    }

    if ((profile.rejected_models || []).some((x) => name.includes(x))) {
      score -= 3;
    }

    return { model, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const top = scored[0]?.model;
  const backup = scored[1]?.model;

  if (!top) return null;

  const reasons = [];

  if (profile.price_sensitive) reasons.push("你之前提到比较在意预算");
  if (profile.needs_color) reasons.push("你对彩色显示有需求");
  if (profile.needs_note_taking) reasons.push("你需要手写或笔记功能");
  if (profile.needs_waterproof) reasons.push("你在意防水能力");
  if (profile.prefers_lightweight) reasons.push("你偏好更轻便的设备");
  if ((profile.main_usage || []).length > 0) {
    reasons.push(`你的主要用途包括：${profile.main_usage.join("、")}`);
  }

  let reply = `结合你之前的偏好，我更推荐你选择 ${top.name}。`;

  if (reasons.length > 0) {
    reply += `\n推荐依据：${reasons.join("；")}。`;
  }

  reply += `\n它更适合：${top.best_for || "当前需求场景"}。`;

  if (backup) {
    reply += `\n备选方案：${backup.name}。`;
  }

  return {
    reply,
    recommendedModel: top.name,
  };
}
