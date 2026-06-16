// app/api/auth/register/route.js
import { NextResponse } from "next/server";

const KV_BASE = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}`;
const CF_HEADERS = {
  "Authorization": `Bearer ${process.env.CF_KV_API_TOKEN}`,
  "Content-Type": "application/json",
};

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

// 简单哈希（生产建议换 bcrypt，Cloudflare Workers 不支持 Node crypto，用 Web Crypto API）
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + process.env.PASSWORD_SALT);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: "用户名和密码不能为空" }, { status: 400 });
    }
    if (username.length < 2 || username.length > 20) {
      return NextResponse.json({ error: "用户名长度须在 2–20 字符之间" }, { status: 400 });
    }
    if (password.length < 4) {
      return NextResponse.json({ error: "密码至少 4 位" }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) {
      return NextResponse.json({ error: "用户名只能包含字母、数字、下划线或汉字" }, { status: 400 });
    }

    // 检查用户名是否已存在
    const existing = await kvGet(`users:${username}`);
    if (existing) {
      return NextResponse.json({ error: "用户名已被占用" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    await kvPut(`users:${username}`, {
      username,
      passwordHash,
      createdAt: Date.now(),
    });

    // 初始化空画像
    await kvPut(`profiles:${username}`, {
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
    });

    return NextResponse.json({ success: true, message: "注册成功" });
  } catch (err) {
    console.error("[register]", err);
    return NextResponse.json({ error: "服务器错误，请稍后重试" }, { status: 500 });
  }
}
