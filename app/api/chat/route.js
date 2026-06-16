// app/api/chat/route.js — 完整替换版
// 知识库检索逻辑不变，记忆系统从 fs 换成 Cloudflare KV，身份验证从 visitorId 换成 JWT

import kb from "@/data/kindle.json";

// ════════════════════════════════════════════════════════════
// Cloudflare KV 工具函数
// ════════════════════════════════════════════════════════════

const KV_BASE = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}`;

async function kvGet(key) {
  const res = await fetch(`${KV_BASE}/values/${encodeURIComponent(key)}`, {
    headers: { "Authorization": `Bearer ${process.env.CF_KV_API_TOKEN}` },
  });
  if (res.status === 404) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function kvPut(key, value) {
  const form = new FormData();
  form.append("value", typeof value === "string" ? value : JSON.stringify(value));
  form.append("metadata", JSON.stringify({}));
  await fetch(`${KV_BASE}/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Authorization": `Bearer ${process.env.CF_KV_API_TOKEN}` },
    body: form,
  });
}

// ════════════════════════════════════════════════════════════
// JWT 验证
// ════════════════════════════════════════════════════════════

async function verifyJWT(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const encoder = new TextEncoder();
    const secret = process.env.JWT_SECRET;
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    const signingInput = `${parts[0]}.${parts[1]}`;
    const sig = Uint8Array.from(
      atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
      c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify("HMAC", key, sig, encoder.encode(signingInput));
    if (!valid) return null;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// 用户画像（替换原来的 fs 版本）
// ════════════════════════════════════════════════════════════

async function getUserProfile(username) {
  const profile = await kvGet(`profiles:${username}`);
  return profile || createEmptyProfile(username);
}

async function saveUserProfile(username, profile) {
  await kvPut(`profiles:${username}`, { ...profile, updatedAt: Date.now() });
}

function createEmptyProfile(username) {
  return {
    username,
    budget: null,
    useCase: [],
    needWaterproof: false,
    needColor: false,
    needStylus: false,
    techLevel: "beginner",
    preferredSeries: [],
    topicHistory: [],
    messageCount: 0,
    lastRecommendation: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ════════════════════════════════════════════════════════════
// 知识库检索（原有逻辑，一行不动，粘贴你 route.js 里从
// normalize() 到 buildProfileContext() 的全部内容）
// ════════════════════════════════════════════════════════════

// ... 把你原来 route.js 里 normalize → buildChunks → synonymMap →
//     scoreChunk → localSearch → generateAnswer → INTENTS →
//     handleColorQuery → handleRecommendQuery → handleTutorialQuery →
//     handleFormatQuery → handleCompareQuery → handleModelQuery →
//     extractPreferencesFromMessage → mergeProfile →
//     buildPersonalizedRecommendation → buildProfileContext
//     全部粘贴在这里，一字不改 ...

// ════════════════════════════════════════════════════════════
// Route Handler
// ════════════════════════════════════════════════════════════

export async function POST(req) {
  try {
    // ── 1. 身份验证（从 Authorization header 取 JWT）──────────
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    const payload = token ? await verifyJWT(token) : null;
    const username = payload?.username || null;

    const body = await req.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const userMessage = messages[messages.length - 1]?.content || "";

    if (!userMessage) {
      return new Response(JSON.stringify({ error: "缺少消息内容" }), { status: 400 });
    }

    // ── 2. 记忆（登录用户才读写画像）──────────────────────────
    let currentProfile = username ? await getUserProfile(username) : createEmptyProfile("guest");
    const preferencePatch = extractPreferencesFromMessage(userMessage);
    const updatedProfile = mergeProfile(currentProfile, preferencePatch);

    if (username) {
      saveUserProfile(username, updatedProfile).catch(err =>
        console.error("[Memory] KV 写入失败:", err.message)
      );
    }

    // ── 3. 知识库路由（原逻辑不变）────────────────────────────
    const intent = detectIntent(userMessage);
    let localReply = null;

    if (intent === INTENTS.COLOR_INFO)      localReply = handleColorQuery(userMessage, kb);
    else if (intent === INTENTS.RECOMMEND) {
      localReply = handleRecommendQuery(userMessage, kb);
      if (!localReply) {
        const personalized = buildPersonalizedRecommendation(updatedProfile, kb);
        if (personalized?.reply) {
          localReply = personalized.reply;
          if (username) updatedProfile.lastRecommendation = personalized.recommendedModel || "";
        }
      }
    }
    else if (intent === INTENTS.TUTORIAL)   localReply = handleTutorialQuery(userMessage, kb);
    else if (intent === INTENTS.FORMAT)     localReply = handleFormatQuery(userMessage, kb);
    else if (intent === INTENTS.COMPARE)    localReply = handleCompareQuery(userMessage, kb);
    else if (intent === INTENTS.MODEL_INFO) localReply = handleModelQuery(userMessage, kb);
    else {
      const hits = localSearch(userMessage);
      if (hits.length > 0 && hits[0].score >= 1) localReply = generateAnswer(hits[0]);
    }

    if (localReply) {
      return new Response(
        JSON.stringify({ reply: localReply, source: "local", intent, profile: updatedProfile }),
        { status: 200 }
      );
    }

    // ── 4. DeepSeek（注入画像）────────────────────────────────
    const profileContext = username ? buildProfileContext(updatedProfile) : "";
    const systemContent = `你是 All of Kindle 网站的专业 Kindle 助手。
优先回答 Kindle 选购、使用、型号区别、格式支持、阅读建议等问题。
回答简洁清晰，避免空话。

${profileContext}

当用户询问推荐类问题时，请结合以上历史偏好给出更个性化的建议。`;

    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "system", content: systemContent }, ...messages],
        temperature: 0.7,
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) return new Response(JSON.stringify(data), { status: upstream.status });

    const reply = data?.choices?.[0]?.message?.content || "暂无回答";
    return new Response(
      JSON.stringify({ reply, source: "deepseek", intent, profile: updatedProfile }),
      { status: 200 }
    );
  } catch (error) {
    console.error("[route]", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
