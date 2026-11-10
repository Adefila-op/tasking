// Sends two items plus a project's guidelines to the model and parses a verdict.
import * as FileSystem from "expo-file-system/legacy";
import * as VideoThumbnails from "expo-video-thumbnails";
import type { GuidelineSource } from "./projects";

export type MediaItem = {
  uri: string;
  kind: "image" | "video";
  durationMs?: number;
};

export type TaskType = "video" | "image" | "generation";
export type QuestionFormat = "lumiere" | "video_annotation";

export const TASK_TYPES: { id: TaskType; label: string; hint: string }[] = [
  { id: "video", label: "Video comparison", hint: "Record or pick two videos" },
  { id: "image", label: "Image comparison", hint: "Capture or pick two images" },
  { id: "generation", label: "Image generation", hint: "Two generated images plus the prompt" },
];

export const QUESTION_FORMATS: { id: QuestionFormat; label: string; hint: string }[] = [
  { id: "lumiere", label: "Lumiere", hint: "Check against the Lumiere checks: GTFA, steps, distractors, licence, failure" },
  { id: "video_annotation", label: "Video annotation", hint: "Five dimensions: overall, instruction, visual, audio, realism" },
];

export type Verdict = {
  winner: "A" | "B" | "tie";
  confidence: number;
  criteria: { guideline: string; A: string; B: string; better: "A" | "B" | "tie" }[];
  reason: string;
};

export type LumierePlan = {
  blindspotQuestion: string;
  imagePrompt: string;
  solution: string;
  distractors: string[];
  checklist: string[];
  whyItWorks: string;
  suggestedFailurePoints: string[];
  fullTask: string;
};

type Block = Record<string, any>;

const MODEL = "claude-sonnet-5-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const FRAME_RATIOS = [0.05, 0.35, 0.65, 0.95];

const REQUEST_TIMEOUT_MS = 120_000;

// fetch that fails with a readable message on timeout or no network.
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("The request timed out after 2 minutes. Try smaller or shorter items, or check the server.");
    throw new Error("Could not reach the server. Check your internet connection and the server address in Settings.");
  } finally {
    clearTimeout(timer);
  }
}

// Make sure whatever came back has the Verdict shape, so the result screen never crashes.
function normalizeVerdict(raw: any): Verdict {
  const pick = (v: any): "A" | "B" | "tie" => {
    const t = String(v ?? "").trim().toUpperCase();
    return t === "A" || t === "B" ? t : "tie";
  };
  const conf = Number(raw?.confidence);
  const criteria = Array.isArray(raw?.criteria) ? raw.criteria : [];
  const paddedCriteria = criteria.length > 0 ? criteria : [
    { guideline: "Overall quality", A: "", B: "", better: "tie" },
    { guideline: "Instruction following", A: "", B: "", better: "tie" },
    { guideline: "Visual accuracy", A: "", B: "", better: "tie" },
    { guideline: "Reasoning quality", A: "", B: "", better: "tie" },
    { guideline: "Completeness", A: "", B: "", better: "tie" },
    { guideline: "Evidence clarity", A: "", B: "", better: "tie" },
  ];
  return {
    winner: pick(raw?.winner),
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf > 1 ? conf / 100 : conf)) : 0,
    criteria: paddedCriteria.slice(0, 6).map((c: any, index: number) => ({
      guideline: String(c?.guideline ?? c?.name ?? [
        "Overall quality",
        "Instruction following",
        "Visual accuracy",
        "Reasoning quality",
        "Completeness",
        "Evidence clarity",
      ][index] ?? "Criterion"),
      A: String(c?.A ?? ""),
      B: String(c?.B ?? ""),
      better: pick(c?.better),
    })),
    reason: String(raw?.reason ?? raw?.explanation ?? "").trim() || "No reason was given.",
  };
}

function extractVerdictJson(text: string): string | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const match = raw.match(/\{[\s\S]*"winner"[\s\S]*\}/i);
  if (match) return match[0];

  const generic = raw.match(/\{[\s\S]*\}/);
  return generic ? generic[0] : null;
}

function buildFallbackVerdict(text: string): Verdict | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const confidenceMatch = raw.match(/\bconfidence\s*[:=]?\s*(0?\.?\d+|100%|\d{1,3}%)/i);
  const confidence = confidenceMatch ? Number(String(confidenceMatch[1]).replace(/%$/, "")) : null;

  const aBetter = /\b(?:item\s+)?a\b[\s\S]{0,120}\b(?:better|preferred|stronger|wins|selected|clear winner)\b|\b(?:better|preferred|stronger|wins|selected|clear winner)\b[\s\S]{0,120}\b(?:item\s+)?a\b/i.test(raw);
  const bBetter = /\b(?:item\s+)?b\b[\s\S]{0,120}\b(?:better|preferred|stronger|wins|selected|clear winner)\b|\b(?:better|preferred|stronger|wins|selected|clear winner)\b[\s\S]{0,120}\b(?:item\s+)?b\b/i.test(raw);
  const tieMatch = /\b(?:tie|draw|equal|same|equally)\b/i.test(raw);

  let inferredWinner: "A" | "B" | "tie" = "tie";
  if (aBetter && !bBetter) inferredWinner = "A";
  else if (bBetter && !aBetter) inferredWinner = "B";
  else if (tieMatch) inferredWinner = "tie";
  else {
    const winnerMatch = raw.match(/\b(?:winner|pick|preference)\s*[:=]?\s*(a|b|tie)\b/i);
    const winner = winnerMatch ? winnerMatch[1].toLowerCase() : null;
    inferredWinner = winner === "a" ? "A" : winner === "b" ? "B" : winner === "tie" ? "tie" : "tie";
  }

  const criteria = [
    {
      guideline: "Visible evidence",
      A: aBetter ? "A is described as stronger or more aligned." : "No clear A evidence extracted.",
      B: bBetter ? "B is described as stronger or more aligned." : "No clear B evidence extracted.",
      better: inferredWinner,
    },
  ];

  const reason = inferredWinner === "A"
    ? "The answer is leaning toward Item A based on the visible comparison language describing A as stronger or better aligned."
    : inferredWinner === "B"
      ? "The answer is leaning toward Item B based on the visible comparison language describing B as stronger or better aligned."
      : "The response did not include a clean JSON verdict, but it did indicate a winner or tie from the visible comparison language.";

  if (!aBetter && !bBetter && !tieMatch && !/\b(?:winner|pick|preference|better|preferred|stronger|tie|draw|equal)\b/i.test(raw)) return null;

  return {
    winner: inferredWinner,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence === null ? 0.5 : confidence > 1 ? confidence / 100 : confidence)) : 0.5,
    criteria,
    reason,
  };
}

function parseVerdict(text: string, who: string): Verdict {
  const lower = String(text).toLowerCase();
  if (lower.includes("nutshell could not format that response") || lower.includes("please run the analysis again")) {
    throw new Error("Nutshell could not format that response. Please run the analysis again.");
  }

  const payload = extractVerdictJson(text);
  if (!payload) {
    const fallback = buildFallbackVerdict(text);
    if (fallback) return fallback;
    throw new Error(`${who} did not return a verdict. Reply was: ${String(text).slice(0, 200) || "(empty)"}`);
  }
  try {
    return normalizeVerdict(JSON.parse(payload));
  } catch {
    const fallback = buildFallbackVerdict(text);
    if (fallback) return fallback;
    throw new Error(`${who} returned a verdict that could not be read.`);
  }
}

export type PageAssistantResult = {
  detectedQuestion: string;
  pageText: string;
  answer: string;
};

function looksLikeQuestion(text: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;
  if (/i cannot see a clear question|no clear question|no question visible|cannot determine/i.test(value)) return false;
  if (value.length < 12) return false;
  return /\?|\b(which|what|who|when|where|why|how|is|are|does|did|should|compare|evaluate|score|choose|identify|find|select|tell me)\b/i.test(value);
}

function parsePageAssistantResponse(rawText: string, fallbackQuestion: string): PageAssistantResult {
  const text = String(rawText ?? "").replace(/```(?:text|json)?/gi, "").trim();
  const pattern = /(?:^|\n)\s*(Detected question|Extracted page text|Answer)\s*:\s*([\s\S]*?)(?=\n\s*(?:Detected question|Extracted page text|Answer)\s*:|$)/gi;
  const blocks: Record<string, string> = {};
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const key = match[1].trim();
    const value = match[2].replace(/^\s*[-•\-]?\s*/, "").trim();
    blocks[key] = value;
  }

  const rawDetectedQuestion = blocks["Detected question"] || fallbackQuestion || "I cannot see a clear question on this page; please provide the question or a clearer screenshot.";
  const detectedQuestion = looksLikeQuestion(rawDetectedQuestion)
    ? rawDetectedQuestion
    : (fallbackQuestion && looksLikeQuestion(fallbackQuestion) ? fallbackQuestion : "I cannot see a clear question on this page; please provide the question or a clearer screenshot.");
  const pageText = blocks["Extracted page text"] || "No page text was clearly extracted from the screenshot.";
  const answer = blocks["Answer"] || text || "I cannot see a clear question on this page; please provide the question or a clearer screenshot.";

  return {
    detectedQuestion,
    pageText,
    answer,
  };
}

async function toBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

async function itemBlocks(label: "A" | "B", item: MediaItem): Promise<Block[]> {
  if (item.kind === "image") {
    return [
      { type: "text", text: `Item ${label} (image):` },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: await toBase64(item.uri) } },
    ];
  }
  const blocks: Block[] = [{ type: "text", text: `Item ${label} (video, sampled frames in time order):` }];
  const duration = item.durationMs ?? 0;
  for (const ratio of FRAME_RATIOS) {
    const time = Math.max(0, Math.round(duration * ratio));
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(item.uri, { time, quality: 0.6 });
      blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await toBase64(thumb.uri) } });
    } catch {
      // skip a frame the decoder can't produce; the others still describe the video
    }
  }
  if (blocks.length === 1) throw new Error(`Could not read any frames from video ${label}. Try recording it again.`);
  return blocks;
}

function guidelineBlocks(g: GuidelineSource): Block[] {
  if (g.kind === "images") {
    return [
      { type: "text", text: `PROJECT GUIDELINES (${g.images.length} photographed page(s), in order). Read every page and apply these rules exactly:` },
      ...g.images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
    ];
  }
  if (g.kind === "pdf") {
    return [
      { type: "text", text: "PROJECT GUIDELINES (attached PDF). Apply these rules exactly:" },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: g.base64 } },
    ];
  }
  return [{ type: "text", text: `PROJECT GUIDELINES. Apply these rules exactly:\n\n${g.text}` }];
}

const FORMAT_RULES: Record<QuestionFormat, string> = {
  video_annotation: `Score exactly these six dimensions, each independently, using the guidelines' definitions:
"Overall quality", "Instruction following", "Visual accuracy", "Reasoning quality", "Completeness", "Evidence clarity".
Each gets better: "A" | "B" | "tie" and a one to three sentence justification naming specific observed evidence.
Return a winner for all six rubrics, not just the overall outcome. Use the guideline as the scoring reference and the image itself as the primary evidence.`,
  lumiere: `Check both items against the Lumiere checks in the guidelines, such as: the prompt is specific and unambiguous;
there is one verifiable final answer (GTFA) in the requested format; the step-by-step solution is atomic and supports the GTFA;
there are five distractors tied to real errors; the image description is complete and does not reveal the answer;
the source and licence are eligible; the model failure is genuine and justified.
Each check is one criteria entry with better: "A" | "B" | "tie". Report failing checks plainly and quote the guideline rule they break.`,
};

const TYPE_RULES: Record<TaskType, string> = {
  video: "Both items are videos, supplied as sampled frames in time order.",
  image: "Both items are images.",
  generation: "Both items are images generated from the TASK prompt. Judge prompt adherence as well as the guidelines.",
};

const SYSTEM = `You compare two items (Item A and Item B) strictly against the PROJECT GUIDELINES in the message.
Use the provided images as the primary visual evidence and the guideline text as the scoring reference.
Judge only what is visible or sampled. Do not reward length or effort.
Return six rubric entries in the criteria array, each with a clear winner: "A" | "B" | "tie" and a short justification.
The final overall winner can be derived from the six rubric winners, but do not omit any rubric.
Report violations honestly. Never suggest wording that hides a violation from an automated checker.
Respond with ONLY a JSON object, no prose, in this shape:
{"winner":"A"|"B"|"tie","confidence":0..1,"criteria":[{"guideline":"criterion name","A":"short note","B":"short note","better":"A"|"B"|"tie"},{"guideline":"criterion name","A":"short note","B":"short note","better":"A"|"B"|"tie"},{"guideline":"criterion name","A":"short note","B":"short note","better":"A"|"B"|"tie"},{"guideline":"criterion name","A":"short note","B":"short note","better":"A"|"B"|"tie"},{"guideline":"criterion name","A":"short note","B":"short note","better":"A"|"B"|"tie"},{"guideline":"criterion name","A":"short note","B":"short note","better":"A"|"B"|"tie"}],"reason":"two or three sentences"}`;

export type CompareOptions = {
  type: TaskType;
  format: QuestionFormat;
  question: string;
  a: MediaItem;
  b: MediaItem;
  onProgress?: (stage: string) => void;
};

// "nutshell" sends comparisons to your Nutshell server (/api/solve).
// "anthropic" calls the Claude API directly with the key on this device.
// Default to Anthropic so the page assistant can inspect the screenshot image itself and use OCR as extra context.
export const BACKEND: "anthropic" | "nutshell" = "anthropic";
export const DEFAULT_NUTSHELL_BASE = "https://gj3y4v5ve340vhnemdrs.c.websim.com";

async function compareNutshell(base: string, guidelines: GuidelineSource, o: CompareOptions): Promise<Verdict> {
  if (guidelines.kind === "pdf") {
    throw new Error("PDF guides can't go to the Nutshell backend. Use a text or photo guide.");
  }
  const media: Block[] = [];
  if (guidelines.kind === "images") {
    media.push({
      id: "guidelines", name: "Guideline pages", alt: "Guideline pages", kind: "image", duration: 0,
      frames: guidelines.images.map((d, i) => ({ src: `data:image/jpeg;base64,${d}`, time: i })),
    });
  }
  for (const [label, item] of [["A", o.a], ["B", o.b]] as const) {
    o.onProgress?.(item.kind === "video" ? `Reading frames from video ${label}…` : `Preparing image ${label}…`);
    const blocks = await itemBlocks(label, item);
    const frames = blocks.filter((b) => b.type === "image").map((b) => b.source.data as string);
    media.push({
      id: `item-${label}`, name: `Item ${label}`, alt: `Item ${label}`, kind: item.kind,
      duration: item.durationMs ?? 0,
      frames: frames.map((d, i) => ({ src: `data:image/jpeg;base64,${d}`, time: i })),
    });
  }
  const guideText = guidelines.kind === "text" ? guidelines.text : "(see the guideline pages attached as media)";
  const taskLine = o.type === "generation"
    ? `TASK (generation prompt): ${o.question || "(none given)"}`
    : `TASK: ${o.question || "Which item is better according to the guidelines?"}`;
  const text = [
    "PROJECT GUIDELINES:", guideText, "",
    "ITEM TYPE: " + TYPE_RULES[o.type], "QUESTION FORMAT:", FORMAT_RULES[o.format], "",
    taskLine, "",
    "Compare Item A and Item B against the guidelines. Respond with ONLY a JSON object, no prose, in this shape:",
    `{"winner":"A"|"B"|"tie","confidence":0..1,"criteria":[{"guideline":"criterion name","A":"short note","B":"short note","better":"A"|"B"|"tie"}],"reason":"two or three sentences"}`,
  ].join("\n");

  o.onProgress?.("Asking the judge… this can take up to a minute");
  const answer = await solveNutshell(base, text, media, "Tasking comparison", o.onProgress);
  try {
    return parseVerdict(answer, "The Nutshell backend");
  } catch (error: any) {
    const message = String(error?.message || error || "");
    if (/Nutshell could not format that response|please run the analysis again/i.test(message)) {
      o.onProgress?.("Retrying the analysis…");
      const retryAnswer = await solveNutshell(base, text, media, "Tasking comparison", o.onProgress);
      return parseVerdict(retryAnswer, "The Nutshell backend");
    }
    throw error;
  }
}

// Quick reachability check for the Settings screen.
export async function pingNutshell(base: string): Promise<string> {
  const url = `${base.replace(/\/$/, "")}/api/health`;
  const res = await fetchWithTimeout(url, { method: "GET" });
  if (!res.ok) throw new Error(`Server answered ${res.status} at /api/health.`);
  const body = await res.text().catch(() => "");
  return body.slice(0, 120) || "OK";
}

async function callAnthropic(apiKey: string, payload: Record<string, any>): Promise<any> {
  const key = apiKey?.trim();
  if (!key) throw new Error("Add your Anthropic API key in Settings first.");

  const res = await fetchWithTimeout(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.error?.message || data?.error || `Anthropic request failed (${res.status})`;
    throw new Error(detail);
  }
  return data;
}

async function compareAnthropic(apiKey: string, guidelines: GuidelineSource, o: CompareOptions): Promise<Verdict> {
  const taskLine = o.type === "generation"
    ? `TASK (generation prompt): ${o.question || "(none given)"}`
    : `TASK: ${o.question || "Which item is better according to the guidelines?"}`;

  o.onProgress?.(o.a.kind === "video" ? "Reading frames from video A…" : "Preparing image A…");
  const blocksA = await itemBlocks("A", o.a);
  o.onProgress?.(o.b.kind === "video" ? "Reading frames from video B…" : "Preparing image B…");
  const blocksB = await itemBlocks("B", o.b);
  const content: Block[] = [
    ...guidelineBlocks(guidelines),
    { type: "text", text: `ITEM TYPE: ${TYPE_RULES[o.type]}\nQUESTION FORMAT:\n${FORMAT_RULES[o.format]}\n\n${taskLine}` },
    ...blocksA,
    ...blocksB,
    { type: "text", text: "Return the JSON verdict now." },
  ];
  o.onProgress?.("Asking the judge… this can take up to a minute");

  const data = await callAnthropic(apiKey, { model: MODEL, max_tokens: 2000, system: SYSTEM, messages: [{ role: "user", content }] });
  const text: string = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  return parseVerdict(text, "The model");
}

export async function compareItems(apiKey: string, guidelines: GuidelineSource, o: CompareOptions & { nutshellBase?: string }): Promise<Verdict> {
  return compareAnthropic(apiKey, guidelines, o);
}

function buildPageAssistantPrompt(question: string, ocrText?: string): string {
  return [
    "You are a page-question extractor and evaluator for this screenshot.",
    "Use the screenshot image as the primary evidence and the OCR text as a support layer. The image is the source of truth for what is visible on the page.",
    "Follow this exact workflow: 1) read the visible text, 2) detect the actual question or task on the page, 3) identify visible UI elements, 4) answer only that question from the screenshot, 5) if no clear question is visible, say so plainly.",
    "Extract the visible text first, including headings, labels, instructions, buttons, captions, answer choices, and any rubric or comparison text.",
    "Then state the detected question that the page is asking.",
    "Then provide the final answer. Keep the final answer grounded in the visible page evidence only.",
    "If the page includes a rubric, criteria, or scoring guidance, apply it to the answer and cite the visible rule from the screenshot.",
    "Do not summarize the page generically. Do not say there is nothing to copy. Do not say you cannot see the image unless there is genuinely no clear question visible.",
    "Return your response in this exact format:",
    "Detected question: ...",
    "Extracted page text: ...",
    "Answer: ...",
    "If no question is visible, set Detected question to: I cannot see a clear question on this page; please provide the question or a clearer screenshot.",
    ocrText ? `OCR text on the page:\n${ocrText}` : "",
    `QUESTION: ${question || "Detect the comparison or guideline question visible on this page and answer it from the screenshot itself."}`,
  ].join("\n");
}

async function analyzePageAnthropic(apiKey: string, imageUri: string, question: string, onProgress?: (stage: string) => void, ocrText?: string): Promise<PageAssistantResult> {
  const blocks = await itemBlocks("A", { uri: imageUri, kind: "image" });
  const prompt = buildPageAssistantPrompt(question, ocrText);

  onProgress?.("Analyzing the page… this can take up to a minute");
  const data = await callAnthropic(apiKey, { model: MODEL, max_tokens: 2000, messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...blocks] }] });

  const answer = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
  if (!answer) throw new Error("The model did not return an answer for the page.");
  return parsePageAssistantResponse(answer, question || "Detect the comparison or guideline question visible on this page and answer it from the screenshot itself.");
}

export async function analyzePage(apiKey: string, imageUri: string, question: string, nutshellBase?: string, onProgress?: (stage: string) => void, ocrText?: string): Promise<PageAssistantResult> {
  return analyzePageAnthropic(apiKey, imageUri, question, onProgress, ocrText);
}

// ---------- Stomp a model: write a new Lumiere-style task ----------
const DRAFT_RULES = `You are drafting ONE new task that must pass the Lumiere checks in the PROJECT GUIDELINES.
Produce, in this order, with clear headings:
1. Prompt: specific and unambiguous.
2. GTFA: one verifiable final answer in the requested format.
3. Step-by-step solution: atomic steps that support the GTFA.
4. Distractors: five, each tied to a real, plausible error.
5. Image description: complete, and it must not reveal the answer.
6. Source and licence: state what must be checked for eligibility.
7. Open questions: anything the brief does not settle. Do not invent facts the brief does not support.
Follow the guidelines exactly. Do not make the task easier to pass than the guidelines allow.`;

async function solveNutshell(base: string, text: string, media: Block[], title = "Tasking draft", onProgress?: (stage: string) => void): Promise<string> {
  let lastMessage = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(`${base.replace(/\/$/, "")}/api/solve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text, url: "", title, fields: [], media, document: null,
          modelConfig: { provider: "hosted" },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        const err = data?.error || `Nutshell backend request failed (${res.status}).`;
        lastMessage = String(err);
        if (attempt === 1) {
          onProgress?.("Retrying the analysis…");
          continue;
        }
        throw new Error(lastMessage);
      }
      const answer = typeof data.answer === "string" ? data.answer : (data.items?.[0]?.answer || data.items?.[0]?.fill || "");
      const result = String(answer).trim();
      if (result && /Nutshell could not format that response|please run the analysis again/i.test(result)) {
        lastMessage = result;
        if (attempt === 1) {
          onProgress?.("Retrying the analysis…");
          continue;
        }
        throw new Error(result);
      }
      return result;
    } catch (e: any) {
      const message = String(e?.message || e || "");
      if (attempt === 1 && /Nutshell could not format that response|please run the analysis again|request failed|timed out/i.test(message)) {
        onProgress?.("Retrying the analysis…");
        lastMessage = message;
        continue;
      }
      throw e;
    }
  }

  throw new Error(lastMessage || "Nutshell could not format that response. Please run the analysis again.");
}

export async function draftTask(apiKey: string, guidelines: GuidelineSource, brief: string, nutshellBase?: string): Promise<string> {
  const content: Block[] = [
    ...guidelineBlocks(guidelines),
    { type: "text", text: `${DRAFT_RULES}\n\nBRIEF:\n${brief}` },
  ];
  const data = await callAnthropic(apiKey, { model: MODEL, max_tokens: 3000, messages: [{ role: "user", content }] });
  return (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
}

function parseJsonObject(text: string): Record<string, any> | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

export async function buildLumierePlan(apiKey: string, niche: string, goal: string, selectedFailurePoint?: string): Promise<LumierePlan> {
  const safeNiche = (niche || "life science").trim() || "life science";
  const safeGoal = (goal || "Design a prompt that forces a general-purpose model to miss a subtle scientific detail.").trim();
  const safeFailurePoint = (selectedFailurePoint || "Look for the most visually salient but scientifically wrong interpretation").trim();

  const data = await callAnthropic(apiKey, {
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: `You are designing a adversarial Lumiere task whose purpose is to trap a general-purpose model into a confident but wrong answer.\n\nNiche: ${safeNiche}\nGoal: ${safeGoal}\nSelected failure point: ${safeFailurePoint}\n\nDesign the task to be a strong trap, not a generic quiz. The image must be grounded in the science and the wrong answers must look plausible. For a test model, the most likely failure is to focus on the wrong cue: the selected failure point.\n\nReturn JSON only with these keys:\n{\n  "blindspotQuestion": "Write a single direct trap question targeted at the selected failure point. It should tempt the model to choose the wrong interpretation while still requiring a grounded answer based on the image.",\n  "imagePrompt": "Write a short but explicit scientific image-generation prompt that visually includes the trap detail but does not reveal the answer. It should produce a scene that makes the wrong answer look plausible.",\n  "solution": "A concise answer that correctly identifies the true interpretation and explains why the trap is wrong.",\n  "distractors": ["...", "...", "...", "...", "..."],\n  "checklist": ["GTFA", "atomic steps", "distraction quality", "image description is not revealing", "source and license check", "failure mode is justified"],\n  "suggestedFailurePoints": ["...", "...", "...", "..."],\n  "whyItWorks": "Explain why this specific failure point is likely to fool a general model and why the real answer remains scientifically grounded.",\n  "fullTask": "Write the complete task brief as it will be handed to the test model, including the trap question, the image-generation prompt, the correct answer, the distractor set, and the reasoning this task is meant to expose."\n}`,
      }],
    }],
  });

  const text = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
  const parsed = parseJsonObject(text) || {};

  const blindspotQuestion = String(parsed.blindspotQuestion || parsed.question || `What is the most likely correct interpretation of the scientific image in the ${safeNiche} context?`).trim();
  const imagePrompt = String(parsed.imagePrompt || `Create an image of a nuanced ${safeNiche} scene with subtle but diagnostically important details that can be misread by a general model.`).trim();
  const solution = String(parsed.solution || "The correct answer depends on the subtle detail visible in the image and should be justified by the evidence." ).trim();
  const distractors = Array.isArray(parsed.distractors) ? parsed.distractors.map((x: any) => String(x).trim()).filter(Boolean) : [
    "A plausible but incorrect interpretation based on surface style only.",
    "A partial answer that ignores the key scientific cue.",
    "An answer with the right subject but the wrong mechanism.",
    "An overly broad statement that misses the precise detail.",
    "A distractor that is visually similar but scientifically impossible.",
  ];
  const checklist = Array.isArray(parsed.checklist) ? parsed.checklist.map((x: any) => String(x).trim()).filter(Boolean) : [
    "GTFA",
    "atomic steps",
    "distraction quality",
    "image description is not revealing",
    "source and license check",
    "failure mode is justified",
  ];
  const suggestionPool = Array.isArray(parsed.suggestedFailurePoints) || Array.isArray(parsed.failurePoints)
    ? (Array.isArray(parsed.suggestedFailurePoints) ? parsed.suggestedFailurePoints : parsed.failurePoints)
    : [
        `Misread the key anatomical or molecular signal in a ${safeNiche.toLowerCase()} image`,
        `Confuse a background artifact with the true diagnostic feature`,
        `Ignore the temporal or procedural sequence implied by the image`,
        `Over-value a visually salient but scientifically irrelevant pattern`,
      ];
  const suggestedFailurePoints = suggestionPool
    .map((x: any) => String(x).trim())
    .filter(Boolean)
    .slice(0, 5);
  const whyItWorks = String(parsed.whyItWorks || `This prompt targets a ${safeNiche} detail that is easy to miss but critical to the scientific interpretation.`).trim();
  const fullTask = String(parsed.fullTask || [
    `Task: ${blindspotQuestion}`,
    `Image prompt: ${imagePrompt}`,
    `Correct answer: ${solution}`,
    `Distractors: ${distractors.join("; ")}`,
    `Why this trap works: ${whyItWorks}`,
  ].join("\n")).trim();

  return {
    blindspotQuestion,
    imagePrompt,
    solution,
    distractors: distractors.slice(0, 5),
    checklist: checklist.slice(0, 6),
    whyItWorks,
    suggestedFailurePoints: suggestedFailurePoints.length > 0 ? suggestedFailurePoints : [
      `Misread the key diagnostic cue in the ${safeNiche.toLowerCase()} sample`,
      `Mistake a background artifact for the actual signal`,
      `Ignore the critical step or orientation required to interpret the image`,
    ],
    fullTask,
  };
}
