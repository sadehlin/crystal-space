/* =====================================================================
   Crystal's Space — Private Content Chat (Cloudflare Worker)
   =====================================================================
   Backend for crystal-space.html — the private chat only Crystal uses
   to update Married in Cabo content: Bride Binder budget/vendor
   fill-ins, marriedincabo.com site wording, and general planning notes.

   Every change she makes is written straight to this Worker's KV store
   the moment she sends the message — nothing waits on Steven reviewing
   or approving it first. That KV store is the shared "source of truth"
   Steven (or a Claude session) can pull from later to update the live
   site and regenerate the Bride Binder PDFs — a static PDF and a
   deployed site can't update themselves, so that pull step is the one
   thing that still needs a human/Claude to run it. Everything up to
   that point is fully automatic.

   Steven: pull the latest saved content anytime with
     GET  <your-worker-url>/state     (header: x-space-pin: <your PIN>)

   See README.md in this repo for the one-click deploy flow.
   ===================================================================== */

const SYSTEM_PROMPT = `
You are Crystal's private assistant for the Married in Cabo wedding
business. This chat is Crystal's own space — Steven doesn't see it live,
he only pulls in saved updates later, separately. Whenever Crystal tells
you something that should be changed, updated, or just remembered, call
record_change once for each distinct item (one message can contain more
than one thing to save). Use these categories:

- "budget": a dollar amount or line item for The Real Budget PDF
  (key = the line item name, e.g. "photography", "venue", "catering")
- "vendor": details for a Little Black Book vendor (key = vendor name;
  value should fold in price, contact info, and notes into one clear string)
- "sitecopy": wording that appears on marriedincabo.com (key = a short
  slug for the section, e.g. "dress_code", "venue_description", "faq_kids")
- "note": anything else worth remembering — a decision, a reminder, an
  idea (key = a short slug you make up, e.g. "florist_repricing")

After calling record_change for everything in her message, reply warmly
and specifically, in Crystal's own voice — confirm exactly what you just
saved so she knows it landed and doesn't need to double-check with
Steven. Keep it short (1-3 sentences). If she's just chatting, asking a
question, or hasn't told you anything to save, reply naturally without
calling the tool.
`.trim();

const MODEL = "claude-3-5-haiku-latest"; // same model already proven in crystal-worker.js
const MAX_TURNS = 16;

// CORS — lock this to wherever you host crystal-space.html once it's settled
const ALLOW_ORIGIN = "*";

const TOOLS = [{
  name: "record_change",
  description: "Save one specific change or note to the shared Married in Cabo content store.",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: ["budget", "vendor", "sitecopy", "note"] },
      key: { type: "string", description: "short identifier, e.g. 'photography', 'dress_code', 'florist'" },
      value: { type: "string", description: "the new value or content to save" },
      summary: { type: "string", description: "one line for the change log, e.g. 'Photography budget updated to $3,200'" },
    },
    required: ["category", "key", "value", "summary"],
  },
}];

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-space-pin",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const pin = request.headers.get("x-space-pin") || url.searchParams.get("pin") || "";
    if (!env.SPACE_PIN || pin !== env.SPACE_PIN) {
      return json({ error: "forbidden" }, 403, cors);
    }

    if (request.method === "GET" && url.pathname.replace(/\/$/, "") === "/state") {
      const state = await loadState(env);
      return json(state, 200, cors);
    }

    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

    let messages;
    try {
      ({ messages } = await request.json());
    } catch {
      return json({ error: "Bad JSON" }, 400, cors);
    }
    if (!Array.isArray(messages)) return json({ error: "messages[] required" }, 400, cors);

    let turns = messages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && m.content)
      .slice(-MAX_TURNS)
      .map(m => ({ role: m.role, content: String(m.content) }));
    while (turns.length && turns[0].role !== "user") turns.shift();
    if (!turns.length) {
      return json({ reply: "Hi love! What would you like me to save? 💫", changes: [] }, 200, cors);
    }

    try {
      const r1 = await callClaude(env, turns);
      const data1 = await r1.json();
      if (!r1.ok) {
        console.error("Anthropic error", data1);
        return json({ reply: "Sorry, I'm having a little trouble right now — try again in a moment? 💛", changes: [] }, 200, cors);
      }

      const toolUses = (data1.content || []).filter(b => b.type === "tool_use");
      if (!toolUses.length) {
        const reply = extractText(data1) || "Okay! 💫";
        return json({ reply, changes: [] }, 200, cors);
      }

      const state = await loadState(env);
      const changes = [];
      for (const tu of toolUses) {
        applyChange(state, tu.input);
        changes.push(tu.input.summary || `${tu.input.category}: ${tu.input.key}`);
      }
      await saveState(env, state);

      // second call so Claude can give a natural, specific confirmation
      const turns2 = [
        ...turns,
        { role: "assistant", content: data1.content },
        { role: "user", content: toolUses.map(tu => ({ type: "tool_result", tool_use_id: tu.id, content: "saved" })) },
      ];
      const r2 = await callClaude(env, turns2);
      const data2 = await r2.json();
      const reply = (r2.ok && extractText(data2)) || `Got it — saved: ${changes.join("; ")} 💫`;

      return json({ reply, changes }, 200, cors);
    } catch (err) {
      console.error(err);
      return json({ reply: "Something glitched on my end — mind trying that again? 💛", changes: [] }, 200, cors);
    }
  },
};

async function callClaude(env, turns) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: turns,
    }),
  });
}

function extractText(data) {
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
}

async function loadState(env) {
  const raw = await env.SPACE_KV.get("content");
  return raw ? JSON.parse(raw) : { budget: {}, vendor: {}, sitecopy: {}, notes: [] };
}
async function saveState(env, state) {
  await env.SPACE_KV.put("content", JSON.stringify(state));
}
function applyChange(state, input) {
  const { category, key, value } = input || {};
  if (!category || !key) return;
  if (category === "note") {
    state.notes.push({ key, value: value || "", at: new Date().toISOString() });
  } else if (state[category]) {
    state[category][key] = value || "";
  }
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}
