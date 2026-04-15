export async function POST(req) {
  try {
    const body = await req.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (!process.env.DEEPSEEK_API_KEY) {
      return new Response(
        JSON.stringify({ error: "DEEPSEEK_API_KEY is missing" }),
        { status: 500 }
      );
    }

    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "你是一个专业、克制、准确的 Kindle 助手。只回答与 Kindle 选购、使用、功能、型号对比、故障排查相关的问题。回答简洁清楚，不编造。"
          },
          ...messages
        ],
        temperature: 0.7,
        stream: false
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return new Response(JSON.stringify(data), { status: upstream.status });
    }

    const text =
      data?.choices?.[0]?.message?.content || "暂时没有获取到回答。";

    return new Response(
      JSON.stringify({ reply: text }),
      { status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || "Server error" }),
      { status: 500 }
    );
  }
}
