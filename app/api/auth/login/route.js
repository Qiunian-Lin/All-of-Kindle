// app/api/auth/login/route.js
import { NextResponse } from "next/server";

const KV_BASE = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}`;

async function kvGet(key) {
  const res = await fetch(`${KV_BASE}/values/${encodeURIComponent(key)}`, {
    headers: { "Authorization": `Bearer ${process.env.CF_KV_API_TOKEN}` },
  });
  if (res.status === 404) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + process.env.PASSWORD_SALT);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// 生成简单 JWT（HS256，用 Web Crypto API，兼容 Edge Runtime）
async function signJWT(payload) {
  const secret = process.env.JWT_SECRET;
  const encoder = new TextEncoder();

  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, "");
  const body = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 })) // 30天
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const signingInput = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  return `${signingInput}.${sig}`;
}

export async function POST(req) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: "请填写用户名和密码" }, { status: 400 });
    }

    const user = await kvGet(`users:${username}`);
    if (!user) {
      return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
    }

    const inputHash = await hashPassword(password);
    if (inputHash !== user.passwordHash) {
      return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
    }

    const token = await signJWT({ username, sub: username });

    return NextResponse.json({ success: true, token, username });
  } catch (err) {
    console.error("[login]", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
