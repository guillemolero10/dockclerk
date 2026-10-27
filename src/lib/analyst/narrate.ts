// The analyst's voice. Code has already worked out every number; Muse Spark Open reads the
// findings, decides what matters most this week and says it plainly. A guard then checks that
// every figure it wrote is in the data, and drops what is not. Without a key, a template writes it.

import { chat, parseJson, providers } from "@/lib/ai/client";
import type { Finding, Gap, Step } from "./types";

type Story = { headline: string; summary: string; order: string[]; notes: Record<string, string> };

const SYSTEM = `You are the analyst agent inside DockClerk, the back office of a small logistics warehouse (3PL).
Code has already analysed six months of the warehouse's data; you receive its findings with their statistics.
Your job is the judgement a good analyst adds: what matters most this week, and what to do first.

Rules:
- Use only numbers that appear in the findings. Never compute, round differently or invent a figure.
- Plain English for a warehouse manager. No statistics jargon in the summary.
- Prefer findings that need action this week (stock running out, space, late trucks) over slow trends.
- Mention at most three findings in the summary.

Answer with JSON only:
{"headline": "one line, max 90 characters",
 "summary": "three or four short sentences",
 "order": ["finding ids, most important first"],
 "notes": {"<finding id>": "one sentence: why it matters this week or what to do first"}}`;

/** Every number written in the findings, as the guard accepts them. */
function numbersIn(findings: Finding[], gaps: Gap[], days: number) {
  const text = [
    ...findings.flatMap((f) => [f.title, f.body, f.method, ...f.evidence.flatMap((e) => [e.label, e.value])]),
    ...gaps.map((g) => g.text),
    String(days),
  ].join(" ");
  return new Set(extract(text));
}

const extract = (text: string) => (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(",", "."))));

/** True when every figure in the text is in the data (small counts like "two" or "3 things" are allowed). */
function guarded(text: string, allowed: Set<string>) {
  return extract(text).every((n) => allowed.has(n) || Number(n) <= 3);
}

function template(findings: Finding[], gaps: Gap[]): Story {
  const top = findings.slice(0, 3);
  const summary = top.length
    ? `This week ${findings.length === 1 ? "one thing stands" : `${findings.length} things stand`} out. ` +
      `First: ${top[0].title.charAt(0).toLowerCase()}${top[0].title.slice(1)}. ` +
      (top[1] ? `Then: ${top.slice(1).map((f) => f.title.charAt(0).toLowerCase() + f.title.slice(1)).join("; ")}. ` : "") +
      (gaps.length ? `Some questions need more history before I can answer them.` : "")
    : "Nothing in the data needs action this week.";
  return { headline: top[0]?.title ?? "All clear this week", summary: summary.trim(), order: findings.map((f) => f.id), notes: {} };
}

export async function narrate(findings: Finding[], gaps: Gap[], days: number): Promise<{ story: Story; brain: string; steps: Step[] }> {
  const fallback = template(findings, gaps);
  const p = providers.agent();
  if (!p || !findings.length) {
    return { story: fallback, brain: "rules", steps: [{ kind: "tool", text: "brain → report template (plan B, no model key)" }] };
  }

  const steps: Step[] = [{ kind: "tool", text: `brain → ${p.name} reads ${findings.length} findings and decides the priorities` }];
  try {
    const input = {
      days,
      findings: findings.map((f) => ({ id: f.id, kind: f.kind, score: f.score, confidence: f.confidence, title: f.title, body: f.body, evidence: f.evidence })),
      gaps,
    };
    const answer = await chat(p, [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify(input) }], { json: true, maxTokens: 900 });
    const raw = parseJson<Partial<Story>>(answer.content);
    const allowed = numbersIn(findings, gaps, days);
    const ids = new Set(findings.map((f) => f.id));

    const story: Story = { ...fallback, notes: {} };
    let dropped = 0;
    if (raw.headline && guarded(raw.headline, allowed)) story.headline = raw.headline.slice(0, 120);
    else if (raw.headline) dropped++;
    if (raw.summary) {
      const kept = raw.summary.split(/(?<=[.!?])\s+/).filter((sentence) => guarded(sentence, allowed) || (dropped++, false));
      if (kept.length) story.summary = kept.join(" ");
    }
    if (Array.isArray(raw.order)) {
      const order = raw.order.filter((id) => ids.has(id));
      story.order = [...new Set([...order, ...findings.map((f) => f.id)])];
    }
    for (const [id, note] of Object.entries(raw.notes ?? {})) {
      if (!ids.has(id) || typeof note !== "string") continue;
      if (guarded(note, allowed)) story.notes[id] = note;
      else dropped++;
    }
    steps.push({ kind: "ok", text: `priorities set by ${p.name}: ${story.order.slice(0, 3).join(", ")}` });
    steps.push(
      dropped
        ? { kind: "ask", text: `number guard: dropped ${dropped} sentence${dropped === 1 ? "" : "s"} with a figure that is not in the data` }
        : { kind: "ok", text: "number guard: every figure in the text is in the data" },
    );
    return { story, brain: p.name, steps };
  } catch (error) {
    console.error("Analyst narrative failed, using the template", error);
    steps.push({ kind: "ask", text: "model unavailable → report template (plan B)" });
    return { story: fallback, brain: "rules", steps };
  }
}
