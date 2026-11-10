import { CameraView, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import { recognizeText } from "expo-mlkit-ocr";
import { StatusBar } from "expo-status-bar";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Image, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import Capture from "./Capture";
import type { GuidelineSource } from "./projects";
import { analyzePage, buildLumierePlan, compareItems, draftTask, DEFAULT_NUTSHELL_BASE, MediaItem, pingNutshell, QuestionFormat, TaskType, Verdict, LumierePlan } from "./compare";
import { addHistory, clearHistory, HistoryEntry, listHistory, verdictText } from "./history";
import {
  addProjectFromFile, addProjectFromPhotos, addProjectFromText, deleteProject, listProjects, loadGuidelines, Project,
} from "./projects";
import { BottomNav, Button, C, Card, Empty, Header, MenuRow, NavKey, Progress, Screen, Steps, T, Toast } from "./ui";

const ANTHROPIC_KEY = "anthropic_api_key";
const LAST_GUIDE_KEY = "last_guide_id";
const SHARED_GUIDE_KEY = "shared_tasking_guide";
const DEVICE_ID_KEY = "tasking_device_id";
const ACCESS_CODE_KEY = "tasking_access_code";
const GLOBAL_SHARED_GUIDE_PATH = "/api/shared-guide";

const getMonthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

async function getOrCreateDeviceId() {
  const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (stored) return stored;
  const next = `mobile-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, next).catch(() => {});
  return next;
}

const OUTLIER_GUIDELINE_TEXT = `Outlier comparison guideline

Use the guideline pages as the reference source of truth. Compare item A and item B against the same sequence of checks in the same order as the guideline pages.

1. Start with the first guideline page and use it as the primary reference.
2. Compare the item that better matches the rule, objective, and wording of the guideline.
3. If the match is equal, return a tie.
4. Prefer the item with fewer obvious outlier errors, lower rule violations, and better alignment with the reference page.
5. For video, judge visual and audio quality in the same way as the guideline definitions.

Return the final decision only after checking the full guideline in order and comparing both items against it.`;

type Step =
  | "welcome" | "tasking" | "stomp" | "lumiere" | "author" | "onboarding"
  | "projects" | "pickProject" | "capture" | "page" | "result" | "history" | "settings";

type TaskChoice = {
  n: string;
  label: string;
  sub: string;
  type: TaskType;
  format: QuestionFormat;
  upload?: boolean;  // option 4: upload a new guide first
  stomp?: boolean;   // option 3: review or write a Lumiere task
  noGuide?: boolean; // tasks that can use the shared guideline without a local guide
  page?: boolean;    // page assistant mode for scanning a full webpage
};

const TASK_MENU: TaskChoice[] = [
  { n: "1", label: "Compare image outlier", sub: "Use the shared outlier guideline", type: "image", format: "video_annotation", noGuide: true },
  { n: "2", label: "Compare video outlier", sub: "Use the shared outlier guideline", type: "video", format: "video_annotation", noGuide: true },
  { n: "3", label: "Page assistant", sub: "Scan a webpage and ask a question about it", type: "image", format: "video_annotation", page: true },
  { n: "4", label: "Stomp a model", sub: "Review a draft or write a new Lumiere task", type: "image", format: "lumiere", stomp: true },
  { n: "5", label: "Another project", sub: "Upload the project's guidelines first", type: "image", format: "video_annotation", upload: true },
];

const kindLabel = (p: Project) => (p.kind === "pdf" ? "PDF" : p.kind === "images" ? `${p.paths?.length ?? 1} photo page${(p.paths?.length ?? 1) === 1 ? "" : "s"}` : "Text");
const winnerLabel = (v: Verdict) => (v.winner === "tie" ? "Tie" : `Item ${v.winner} is better`);

export default function App() {
  const [step, setStep] = useState<Step>("welcome");
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [choice, setChoice] = useState<TaskChoice>(TASK_MENU[0]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [pageImage, setPageImage] = useState<string | null>(null);
  const [pageOcrText, setPageOcrText] = useState("");
  const [pageDetectedQuestion, setPageDetectedQuestion] = useState("");
  const [pageExtractedText, setPageExtractedText] = useState("");
  const [pageAnswer, setPageAnswer] = useState("");
  const [showCameraPreview, setShowCameraPreview] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);
  const [guideName, setGuideName] = useState("");
  const [sharedGuideText, setSharedGuideText] = useState(OUTLIER_GUIDELINE_TEXT);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [brief, setBrief] = useState("");
  const [draft, setDraft] = useState("");
  const [lastPair, setLastPair] = useState<{ a: MediaItem; b: MediaItem } | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lumiereNiche, setLumiereNiche] = useState("Life science");
  const [lumiereGoal, setLumiereGoal] = useState("");
  const [lumiereSearch, setLumiereSearch] = useState("life science microscopy");
  const [lumiereResults, setLumiereResults] = useState<{ title: string; url: string; thumb: string; source: string; license: string }[]>([]);
  const [lumiereSelectedSource, setLumiereSelectedSource] = useState<string | null>(null);
  const [lumiereSuggestedTrapTypes, setLumiereSuggestedTrapTypes] = useState<string[]>([]);
  const [lumiereTrapType, setLumiereTrapType] = useState<string | null>(null);
  const [lumiereSelectedFailurePoint, setLumiereSelectedFailurePoint] = useState<string | null>(null);
  const [lumierePlan, setLumierePlan] = useState<LumierePlan | null>(null);
  const [lumiereGeneratedImageUri, setLumiereGeneratedImageUri] = useState<string | null>(null);
  const [lumiereBusy, setLumiereBusy] = useState(false);
  const [lumiereReviewMode, setLumiereReviewMode] = useState(false);
  const [pingNote, setPingNote] = useState("");
  const [lastGuideId, setLastGuideId] = useState<string | null>(null);
  const [cameFrom, setCameFrom] = useState<Step>("welcome");
  const [deviceId, setDeviceId] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [accessLocked, setAccessLocked] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [accessInfo, setAccessInfo] = useState<{ code: string; deviceId: string; activatedAt: string; monthKey: string } | null>(null);

  const say = (msg: string) => { setToast(""); setTimeout(() => setToast(msg), 10); };
  const refresh = useCallback(async () => setProjects(await listProjects()), []);

  useEffect(() => {
    (async () => {
      const currentDeviceId = await getOrCreateDeviceId();
      setDeviceId(currentDeviceId);
      setAccessInfo(null);
      setAccessCode("");
      setAccessLocked(false);
      setAccessError("");

      const storedKey = (await SecureStore.getItemAsync(ANTHROPIC_KEY)) || "";
      setAnthropicApiKey(storedKey);
      setLastGuideId(await SecureStore.getItemAsync(LAST_GUIDE_KEY));
      await refresh();
      await loadSharedGuide();
      setHistory(await listHistory());
    })();
  }, [refresh]);

  const getSharedGuideUrl = (base: string) => `${base.replace(/\/$/, "")}${GLOBAL_SHARED_GUIDE_PATH}`;

  const loadSharedGuide = async () => {
    const base = DEFAULT_NUTSHELL_BASE.trim();
    try {
      const res = await fetch(getSharedGuideUrl(base), { method: "GET" });
      if (res.ok) {
        const text = await res.text();
        if (text.trim()) {
          setSharedGuideText(text.trim());
          return;
        }
      }
    } catch {
      // Fall back to the local device cache below.
    }
    const local = await SecureStore.getItemAsync(SHARED_GUIDE_KEY);
    setSharedGuideText(local || OUTLIER_GUIDELINE_TEXT);
  };

  const saveSharedGuide = async (title: string, referenceText: string) => {
    const text = `${title ? `Guide: ${title}\n\n` : ""}Reference rules:\n${referenceText || OUTLIER_GUIDELINE_TEXT}`.trim();

    try {
      const base = DEFAULT_NUTSHELL_BASE.trim();
      const res = await fetch(getSharedGuideUrl(base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, referenceText: text, updatedAt: Date.now() }),
      });
      if (res.ok) {
        setSharedGuideText(text);
        return;
      }
    } catch {
      // Ignore remote errors and keep the local device copy as a fallback.
    }

    await SecureStore.setItemAsync(SHARED_GUIDE_KEY, text).catch(() => {});
    setSharedGuideText(text);
  };

  const buildRecommendedReference = (title?: string, pageCount = 0) => {
    const nameLabel = title ? `Guide: ${title}` : "Shared guideline";
    const pagesLabel = pageCount > 0 ? ` (${pageCount} page${pageCount === 1 ? "" : "s"})` : "";
    return `${nameLabel}${pagesLabel}. Use the first guideline page as the primary reference. Compare item A and item B against that same sequence of checks in order and choose the item that matches the guideline more closely.`;
  };

  const go = (s: Step) => { setError(""); setStep(s); };
  const goNav = (k: NavKey) => { setCameFrom("welcome"); go(k === "home" ? "welcome" : k === "guides" ? "projects" : k); };
  const navKey: NavKey = step === "projects" ? "guides" : step === "history" ? "history" : step === "settings" ? "settings" : "home";

  const getTrapTypesForNiche = useCallback((niche: string): string[] => {
    const normalized = niche.toLowerCase();
    if (normalized.includes("chemistry")) {
      return [
        "reaction-order trap",
        "spectral-signature misread",
        "equilibrium-vs-rate confusion",
        "functional-group substitution trap",
      ];
    }
    if (normalized.includes("molecular") || normalized.includes("biology")) {
      return [
        "cell-state misclassification",
        "marker-expression trap",
        "spatial-pattern confusion",
        "morphology-vs-function trap",
      ];
    }
    if (normalized.includes("cell")) {
      return [
        "cell-cycle stage trap",
        "toxicity-vs-normality confusion",
        "signal-contrast trap",
        "morphology bias",
      ];
    }
    return [
      "salience-vs-evidence trap",
      "contextual-interpretation trap",
      "background-artifact confusion",
      "rare-detail detection trap",
    ];
  }, []);

  useEffect(() => {
    const nextTypes = getTrapTypesForNiche(lumiereNiche);
    setLumiereSuggestedTrapTypes(nextTypes);
    setLumiereTrapType((current) => current && nextTypes.includes(current) ? current : nextTypes[0] ?? null);
  }, [lumiereNiche, getTrapTypesForNiche]);

  // ---------- settings ----------
  const activateAccessCode = async () => {
    const nextCode = accessCode.trim();
    if (!nextCode) {
      setAccessError("Access code is optional for now.");
      return;
    }

    const currentDeviceId = deviceId || await getOrCreateDeviceId();
    const record = {
      code: nextCode,
      deviceId: currentDeviceId,
      activatedAt: new Date().toISOString(),
      monthKey: getMonthKey(),
    };

    await SecureStore.setItemAsync(ACCESS_CODE_KEY, JSON.stringify(record)).catch(() => {});
    setAccessInfo(record);
    setAccessCode(nextCode);
    setAccessLocked(false);
    setAccessError("");
    say("Access code saved locally");
  };

  const clearAccessCode = async () => {
    await SecureStore.deleteItemAsync(ACCESS_CODE_KEY).catch(() => {});
    setAccessInfo(null);
    setAccessCode("");
    setAccessLocked(false);
    setAccessError("");
    say("Access code cleared");
  };

  const saveSettings = async () => {
    const nextKey = anthropicApiKey.trim();
    await SecureStore.setItemAsync(ANTHROPIC_KEY, nextKey);
    setAnthropicApiKey(nextKey);
    say(nextKey ? "Anthropic API key saved locally" : "Anthropic API key cleared");
  };

  const testConnection = async () => {
    setPingNote(anthropicApiKey.trim() ? "Key looks set locally. It will be used for the next request." : "Add your Anthropic API key first.");
  };

  // ---------- guides ----------
  const chooseProject = async (p: Project) => {
    setProject(p);
    setLastGuideId(p.id);
    await SecureStore.setItemAsync(LAST_GUIDE_KEY, p.id).catch(() => {});
  };

  const uploadFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "text/plain", "text/markdown", "text/html", "application/json"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const file = res.assets[0];
      const saved = await addProjectFromFile(file.name.replace(/\.[^.]+$/, ""), file.uri, file.name);
      await refresh();
      await chooseProject(saved);
      say(`Saved "${saved.name}"`);
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message || "Could not read that file.");
    }
  };

  const savePasted = async () => {
    if (!pasteName.trim() || !pasteText.trim()) return Alert.alert("Missing", "Add a name and the guidelines text.");
    const saved = await addProjectFromText(pasteName.trim(), pasteText);
    const reference = buildRecommendedReference(saved.name, 1);
    await saveSharedGuide(saved.name, `${pasteText.trim()}\n\nReference: ${reference}`);
    setQuestion(reference);
    setPasteName(""); setPasteText(""); setPasteMode(false);
    await refresh();
    await chooseProject(saved);
    say(`Saved "${saved.name}"`);
  };

  const removeProject = (p: Project) => {
    Alert.alert("Delete guide", `Delete "${p.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await deleteProject(p.id);
        if (project?.id === p.id) setProject(null);
        await refresh();
        say("Guide deleted");
      } },
    ]);
  };

  const snapPage = async () => {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) return Alert.alert("Permission needed", "Allow camera access to snap guideline pages.");
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.5 });
    if (!res.canceled && res.assets?.[0]) setPages((p) => [...p, res.assets![0].uri]);
  };

  const pickPages = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("Permission needed", "Allow photo access to pick guideline pages.");
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.5, allowsMultipleSelection: true });
    if (!res.canceled && res.assets?.length) setPages((p) => [...p, ...res.assets.map((a) => a.uri)]);
  };

  const saveSnapped = async () => {
    if (pages.length === 0) return Alert.alert("No pages", "Snap at least one page of the guideline.");
    const name = guideName.trim() || `Guide ${new Date().toLocaleDateString()}`;
    try {
      const saved = await addProjectFromPhotos(name, pages);
      const reference = buildRecommendedReference(name, pages.length);
      await saveSharedGuide(name, `Snap flow reference. Use the pages in order. ${reference}`);
      setQuestion(reference);
      setPages([]); setGuideName("");
      await refresh();
      await chooseProject(saved);
      say(`Saved "${saved.name}"`);
    } catch (e: any) {
      Alert.alert("Save failed", e?.message || "Could not save these pages.");
    }
  };

  // ---------- tasks ----------
  const pickTask = (c: TaskChoice) => {
    setChoice(c);
    setError("");
    setPageAnswer("");
    setPageImage(null);
    if (c.noGuide) { setProject(null); return setStep("capture"); }
    if (c.page) return setStep("page");
    if (c.stomp) return setStep("stomp");
    if (c.upload) { setCameFrom("tasking"); return setStep("projects"); }
    setStep("pickProject");
  };

  const extractQuestionFromOcr = useCallback((text: string) => {
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    const fragments = cleaned.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
    const candidate = fragments.find((part) => /\?|\b(which|what|who|when|where|why|how|compare|choose|score|best|select|identify|evaluate|recommend|answer)\b/i.test(part));
    return candidate ? candidate.replace(/\s+/g, " ").trim() : cleaned.slice(0, 220).replace(/\s+/g, " ").trim();
  }, []);

  const runOcrOnPageImage = useCallback(async (uri: string) => {
    try {
      const result = await recognizeText(uri);
      const text = (result?.text || "").trim();
      setPageOcrText(text);
      if (!question.trim()) {
        const suggested = extractQuestionFromOcr(text);
        if (suggested) setQuestion(suggested);
      }
      return text;
    } catch {
      setPageOcrText("");
      return "";
    }
  }, [extractQuestionFromOcr, question]);

  const openPageCamera = async () => {
    if (!cameraPermission?.granted) {
      const perm = await requestCameraPermission();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow camera access so the app can frame the page before capture.");
        return;
      }
    }
    setShowCameraPreview(true);
  };

  const capturePageFromCamera = async () => {
    if (!cameraRef.current) return;
    const result = await cameraRef.current.takePictureAsync({ quality: 0.7, skipProcessing: true });
    if (result?.uri) {
      setPageImage(result.uri);
      setShowCameraPreview(false);
      await runOcrOnPageImage(result.uri);
    }
  };

  const runPageAssistant = async () => {
    if (!pageImage) return setError("Capture or pick the webpage first.");
    if (!project && projects.length === 0) return setError("Upload or save an onboarding guide first, then compare the page against it.");
    if (!anthropicApiKey.trim()) return setError("Add your Anthropic API key in Settings first.");
    const promptQuestion = question.trim() || "Answer the comparison or guideline question visible on this page using the screenshot itself.";
    setQuestion(promptQuestion);
    setPageDetectedQuestion("");
    setPageExtractedText("");
    setPageAnswer("");
    const ocrText = pageOcrText || (await runOcrOnPageImage(pageImage));
    setBusy(true); setError(""); setStage("Analyzing the page…");
    try {
      const result = await analyzePage(anthropicApiKey.trim(), pageImage, promptQuestion, undefined, setStage, ocrText);
      setPageDetectedQuestion(result.detectedQuestion);
      setPageExtractedText(result.pageText);
      setPageAnswer(result.answer);
    } catch (e: any) {
      setError(e?.message || "Page analysis failed.");
    } finally {
      setBusy(false); setStage("");
    }
  };

  const runCompare = async (a: MediaItem, b: MediaItem, isSwapped = false) => {
    if (!anthropicApiKey.trim()) return setError("Add your Anthropic API key in Settings first.");
    setError(""); setVerdict(null); setLastPair({ a, b }); setSwapped(isSwapped);
    const noGuide = !!choice.noGuide;
    if (!project && !noGuide) return setError("Choose a guide first.");
    setBusy(true); setStage("Loading the guide…");
    try {
      const guidelines: GuidelineSource = project
        ? await loadGuidelines(project)
        : { kind: "text", text: sharedGuideText || OUTLIER_GUIDELINE_TEXT };
      const result = await compareItems(anthropicApiKey.trim(), guidelines, {
        type: choice.type, format: choice.format, question, a, b, onProgress: setStage,
      });
      setVerdict(result);
      setStep("result");
      addHistory({ task: `${choice.n}) ${choice.label}`, type: choice.type, format: choice.format, guide: project?.name ?? null, question, verdict: result })
        .then(async () => setHistory(await listHistory())).catch(() => {});
    } catch (e: any) {
      setError(e?.message || "Comparison failed.");
    } finally {
      setBusy(false); setStage("");
    }
  };

  const rerunSwapped = async () => {
    if (!lastPair) return;
    await runCompare(lastPair.b, lastPair.a, !swapped);
  };

  const shareVerdict = async () => {
    if (!verdict) return;
    const text = verdictText({ id: "", at: Date.now(), task: `${choice.n}) ${choice.label}`, type: choice.type, format: choice.format, guide: project?.name ?? null, question, verdict });
    await Share.share({ message: text }).catch(() => {});
  };

  const runDraft = async () => {
    if (!anthropicApiKey.trim()) return setError("Add your Anthropic API key in Settings first.");
    setError(""); setDraft("");
    if (!project) return setError("Choose a Lumiere guide first.");
    if (!brief.trim()) return setError("Describe the task you want to write.");
    setBusy(true); setStage("Drafting the task… this can take a minute");
    try {
      const guidelines = await loadGuidelines(project);
      setDraft(await draftTask(anthropicApiKey.trim(), guidelines, brief.trim()));
    } catch (e: any) {
      setError(e?.message || "Drafting failed.");
    } finally {
      setBusy(false); setStage("");
    }
  };

  const generateLumierePlanFromGoal = async () => {
    if (!anthropicApiKey.trim()) return setError("Add your Anthropic API key in Settings first.");
    if (!lumiereGoal.trim()) return setError("Describe the scientific blind spot or question you want to target.");
    setError("");
    setLumiereBusy(true);
    try {
      const sourceHint = lumiereSelectedSource ? ` Use this open-source image source as the visual anchor: ${lumiereSelectedSource}` : "";
      const trapTypeHint = lumiereTrapType ? ` Use a blind-spot type of "${lumiereTrapType}" as the primary trap design.` : "";
      const failureHint = lumiereSelectedFailurePoint ? ` The trap should specifically target this failure point: ${lumiereSelectedFailurePoint}.` : "";
      const plan = await buildLumierePlan(anthropicApiKey.trim(), lumiereNiche, `${lumiereGoal.trim()}${sourceHint}${trapTypeHint}${failureHint}`, lumiereSelectedFailurePoint ?? undefined);
      setLumierePlan(plan);
      setLumiereSelectedFailurePoint(plan.suggestedFailurePoints[0] ?? lumiereSelectedFailurePoint ?? null);
      setLumiereReviewMode(true);
      say("Lumiere blind spot generated");
    } catch (e: any) {
      setError(e?.message || "Could not generate the Lumiere plan.");
    } finally {
      setLumiereBusy(false);
    }
  };

  const searchOpenSourceLifeScienceImages = async () => {
    const query = (lumiereSearch || `${lumiereNiche} life science`).trim();
    if (!query) return setError("Enter a niche or image topic to search.");
    setError("");
    setLumiereBusy(true);
    try {
      const candidates = [
        `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=6&license_type=all`,
        `https://commons.wikimedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(query)}&limit=6`,
      ];

      let results: { title: string; url: string; thumb: string; source: string; license: string }[] = [];

      for (const url of candidates) {
        try {
          const res = await fetch(url, {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) continue;

          const data = await res.json();

          if (Array.isArray(data?.results)) {
            results = data.results
              .map((item: any) => ({
                title: item?.title || item?.name || "Open-source image",
                url: item?.url || item?.source || "",
                thumb: item?.thumbnail || item?.image || item?.url || "",
                source: item?.source || "Openverse",
                license: item?.license || item?.license_label || "Open license",
              }))
              .filter((item: any) => item.url && item.thumb)
              .slice(0, 6);
          } else if (Array.isArray(data?.pages)) {
            results = data.pages
              .map((page: any) => {
                const thumb = page?.thumbnail?.source || page?.thumbnail || page?.image || "";
                const urlRef = page?.description || page?.url || "";
                if (!thumb || !urlRef) return null;
                const title = (page?.title || "Open-source image").replace(/^File:/, "");
                return {
                  title,
                  url: urlRef,
                  thumb,
                  source: "Wikimedia Commons",
                  license: page?.license || "Open license",
                };
              })
              .filter(Boolean) as { title: string; url: string; thumb: string; source: string; license: string }[];
          } else if (Array.isArray(data?.items)) {
            results = data.items
              .map((item: any) => ({
                title: item?.title || "Open-source image",
                url: item?.description || item?.url || "",
                thumb: item?.thumbnail?.source || item?.thumbnail || item?.image || "",
                source: item?.source || "Wikimedia Commons",
                license: item?.license || "Open license",
              }))
              .filter((item: any) => item.url && item.thumb)
              .slice(0, 6);
          }

          if (results.length > 0) break;
        } catch {
          // move on to the next search source
        }
      }

      setLumiereResults(results);
      if (results.length > 0) {
        setLumiereSelectedSource(results[0].url);
        say(`${results.length} source images found`);
      } else {
        setLumiereSelectedSource(null);
        setError("No open-source life-science matches were found. Try a more specific image search.");
      }
    } catch (e: any) {
      setError(e?.message || "Open-source image search failed.");
    } finally {
      setLumiereBusy(false);
    }
  };

  const generateLumiereTrapImage = async () => {
    if (!lumierePlan) return setError("Generate the Lumiere plan before creating the image asset.");
    setError("");
    setLumiereBusy(true);
    try {
      const prompt = `${lumierePlan.imagePrompt} ${lumiereTrapType ? `Trap type: ${lumiereTrapType}.` : ""} Scientific style, high detail, clear composition, suitable for a mobile training task.`;
      const encoded = encodeURIComponent(prompt);
      const url = `https://image.pollinations.ai/prompt/${encoded}?width=1200&height=900&seed=${Date.now()}&nologo=true`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Image generator returned ${response.status}.`);
      }

      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the generated image."));
        reader.readAsDataURL(blob);
      });

      const fileUri = `${FileSystem.documentDirectory}lumiere-trap-${Date.now()}.png`;
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      setLumiereGeneratedImageUri(dataUrl);
      say("Image generated and ready to view");
    } catch (e: any) {
      setError(e?.message || "The image generator is unavailable right now.");
    } finally {
      setLumiereBusy(false);
    }
  };

  const shareLumiereTask = async () => {
    if (!lumierePlan) return setError("Generate a Lumiere plan before sharing it.");
    const selectedBlindspot = lumiereSelectedFailurePoint ? `Selected blind-spot: ${lumiereSelectedFailurePoint}` : "Selected blind-spot: not chosen";
    const text = [
      "Lumiere Studio adversarial test",
      `Niche: ${lumiereNiche}`,
      `Trap target: ${lumiereSelectedFailurePoint ?? "AI default trap"}`,
      `Blind-spot question: ${lumierePlan.blindspotQuestion}`,
      `Full task brief:\n${lumierePlan.fullTask}`,
      selectedBlindspot,
      `Image prompt: ${lumierePlan.imagePrompt}`,
      `Expected solution: ${lumierePlan.solution}`,
      `Distractors: ${lumierePlan.distractors.join("; ")}`,
      `Playbook checklist: ${lumierePlan.checklist.join("; ")}`,
    ].join("\n");
    await Share.share({ message: text, url: lumiereGeneratedImageUri ?? undefined }).catch(() => {});
  };

  const nav = <BottomNav active={navKey} onGo={goNav} />;
  const overlay = <><Progress stage={stage} /><Toast message={toast} /></>;

  if (accessLocked) {
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title="Tasking" sub="Access lock removed for now" onBack={() => go("welcome")} />
        <Card>
          <Text style={T.section}>Access lock is off</Text>
          <Text style={T.muted}>The app is open without the code gate while you use the compare and page-assistant features.</Text>
        </Card>
        <Button title="Continue" onPress={() => go("welcome")} />
      </Screen>
    );
  }

  // ================= WELCOME =================
  if (step === "welcome") {
    const last = history[0];
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <View style={styles.hero}>
          <Text style={styles.brand}>Tasking</Text>
          <Text style={T.muted}>
            Anthropic backend · {projects.length} guide{projects.length === 1 ? "" : "s"}
          </Text>
        </View>
        <Pressable style={({ pressed }) => [styles.big, pressed && styles.pressed]} onPress={() => go("tasking")}>
          <Text style={styles.bigTitle}>Tasking</Text>
          <Text style={styles.bigSub}>Compare images or videos, or stomp a model</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.big, styles.bigGhost, pressed && styles.pressed]} onPress={() => go("onboarding")}>
          <Text style={[styles.bigTitle, { color: C.text }]}>Onboarding</Text>
          <Text style={[styles.bigSub, { color: C.muted }]}>Snap a new project's guidelines</Text>
        </Pressable>

        {projects.length === 0 && (
          <Empty title="Start by adding a guide" hint="Options 3 and 4 need a guide. Snap its pages in Onboarding, or upload a file under Guides." action="Snap a guide" onAction={() => go("onboarding")} />
        )}
        {last && (
          <Card onPress={() => go("history")}>
            <Text style={T.section}>Last result</Text>
            <Text style={T.bold}>{winnerLabel(last.verdict)} · {Math.round(last.verdict.confidence * 100)}%</Text>
            <Text style={T.muted} numberOfLines={2}>{last.verdict.reason}</Text>
          </Card>
        )}
        {overlay}
      </Screen>
    );
  }

  // ================= TASKING MENU =================
  if (step === "tasking") {
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title="Tasking" sub="What kind of task is this?" onBack={() => go("welcome")} />
        {TASK_MENU.map((c) => (
          <MenuRow
            key={c.n} n={c.n} title={c.label} hint={c.sub} onPress={() => pickTask(c)}
            badge={c.noGuide ? "no guide needed" : c.stomp ? "Lumiere" : undefined}
          />
        ))}
        {overlay}
      </Screen>
    );
  }

  // ================= STOMP A MODEL =================
  if (step === "stomp") {
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title="Stomp a model" sub="Uses the Lumiere playbook" onBack={() => go("tasking")} />
        <MenuRow title="Lumiere playbook" hint="Generate a blind-spot prompt, image prompt, and solution" onPress={() => go("lumiere")} />
        <MenuRow title="Review two items" hint="Check a pair against the Lumiere checks and get a verdict" onPress={() => { setChoice(TASK_MENU[2]); go("pickProject"); }} />
        <MenuRow title="Write a new task" hint="Describe the task and get a draft that follows the checks" onPress={() => { setDraft(""); go("author"); }} />
        {overlay}
      </Screen>
    );
  }

  if (step === "lumiere") {
    const nurtureOptions = ["Life science", "Biology", "Chemistry", "Molecular imaging", "Cell biology"];
    const progressIndex = !lumierePlan ? (lumiereSelectedSource ? 2 : (lumiereGoal.trim() ? 1 : 0)) : 3;
    const activeBlindspotPrompt = lumierePlan && lumiereSelectedFailurePoint
      ? `Trap the model by testing whether it notices the wrong cue: ${lumiereSelectedFailurePoint}. Question: ${lumierePlan.blindspotQuestion}`
      : (lumierePlan?.blindspotQuestion ?? "");
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title="Lumiere Studio" sub="Step-by-step blind-spot task builder" onBack={() => go("stomp")} />
        <Steps total={4} current={progressIndex} labels={["Niche", "Goal", "Source", "Review"]} />

        <Text style={T.section}>1) Choose the niche</Text>
        <View style={styles.chipWrap}>
          {nurtureOptions.map((option) => (
            <Pressable key={option} onPress={() => setLumiereNiche(option)} style={[styles.chip, lumiereNiche === option && styles.chipSelected]}>
              <Text style={[T.body, lumiereNiche === option && { color: C.text }]}>{option}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={T.section}>2) Suggested blind-spot type for this niche</Text>
        <View style={styles.chipWrap}>
          {lumiereSuggestedTrapTypes.map((option) => (
            <Pressable key={option} onPress={() => setLumiereTrapType(option)} style={[styles.chip, lumiereTrapType === option && styles.chipSelected]}>
              <Text style={[T.body, lumiereTrapType === option && { color: C.text }]}>{option}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={T.section}>3) Define the blind spot</Text>
        <TextInput
          style={T.input}
          multiline
          placeholder="Example: Find the rare cellular marker that distinguishes the treatment from the control image in a microscopy panel."
          placeholderTextColor={C.faint}
          value={lumiereGoal}
          onChangeText={setLumiereGoal}
        />

        <Text style={T.section}>4) Search open-source life-science reference image</Text>
        <TextInput
          style={T.inputSingle}
          placeholder="Search Wikimedia Commons for microscopy, biology, chemistry..."
          placeholderTextColor={C.faint}
          value={lumiereSearch}
          onChangeText={setLumiereSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={T.row}>
          <Button title="Search image" onPress={searchOpenSourceLifeScienceImages} loading={lumiereBusy} small />
          <Button title="Use this source" kind="ghost" onPress={() => setLumiereSelectedSource(lumiereResults[0]?.url || null)} small disabled={!lumiereResults.length} />
        </View>

        {!!lumiereResults.length && (
          <View style={styles.imageGrid}>
            {lumiereResults.map((item) => (
              <Pressable
                key={item.url}
                onPress={() => setLumiereSelectedSource(item.url)}
                style={[styles.sourceCard, lumiereSelectedSource === item.url && styles.sourceCardSelected]}
              >
                <Image source={{ uri: item.thumb }} style={styles.sourceThumb} resizeMode="cover" />
                <Text style={T.bold} numberOfLines={2}>{item.title}</Text>
                <Text style={T.muted} numberOfLines={1}>{item.license}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {!!lumierePlan?.suggestedFailurePoints?.length && (
          <>
            <Text style={T.section}>AI-selected blind spot / failure point</Text>
            <View style={styles.chipWrap}>
              {lumierePlan.suggestedFailurePoints.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setLumiereSelectedFailurePoint(item)}
                  style={[styles.chip, lumiereSelectedFailurePoint === item && styles.chipSelected]}
                >
                  <Text style={[T.body, lumiereSelectedFailurePoint === item && { color: C.text }]}>{item}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Button title="Generate full task" onPress={generateLumierePlanFromGoal} loading={lumiereBusy} />
        <Button title="Generate image for download" kind="ghost" onPress={generateLumiereTrapImage} disabled={!lumierePlan} loading={lumiereBusy} />
        <Button title="Review against playbook" kind="ghost" onPress={() => setLumiereReviewMode(true)} disabled={!lumierePlan} />
        <Button title="Save / share task" kind="ghost" onPress={shareLumiereTask} disabled={!lumierePlan} />

        {!!lumierePlan && (
          <>
            <Card>
              <Text style={T.section}>4) Full task brief</Text>
              <Text style={T.body}>{lumierePlan.fullTask}</Text>
            </Card>

            <Card>
              <Text style={T.section}>Blind-spot prompt</Text>
              <Text style={T.body}>{activeBlindspotPrompt || lumierePlan.blindspotQuestion}</Text>
            </Card>

            {!!lumiereGeneratedImageUri && (
              <Card>
                <Text style={T.section}>Generated trap image</Text>
                <Image source={{ uri: lumiereGeneratedImageUri }} style={{ width: "100%", height: 220, borderRadius: 12, marginBottom: 12 }} resizeMode="cover" />
                <Button title="Open/download image" kind="ghost" onPress={() => Share.share({ url: lumiereGeneratedImageUri, message: "Lumiere generated trap image" }).catch(() => {})} />
              </Card>
            )}

            <Card>
              <Text style={T.section}>Image generation prompt</Text>
              <Text style={T.body}>{lumierePlan.imagePrompt}</Text>
            </Card>

            <Card>
              <Text style={T.section}>Expected solution</Text>
              <Text style={T.body}>{lumierePlan.solution}</Text>
            </Card>

            <Card>
              <Text style={T.section}>Distractors</Text>
              {lumierePlan.distractors.map((item, idx) => (
                <Text key={idx} style={T.body}>• {item}</Text>
              ))}
            </Card>

            {lumiereReviewMode && (
              <Card>
                <Text style={T.section}>Playbook review</Text>
                {lumierePlan.checklist.map((item, idx) => (
                  <Text key={idx} style={T.body}>✓ {item}</Text>
                ))}
                <Text style={T.body}>{lumierePlan.whyItWorks}</Text>
              </Card>
            )}
          </>
        )}

        {!!error && <Text style={T.error}>{error}</Text>}
        {overlay}
      </Screen>
    );
  }

  if (step === "author") {
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title="Write a new task" onBack={() => go("stomp")} />
        <Text style={T.section}>Lumiere guide</Text>
        {projects.length === 0 ? (
          <Empty title="No guides yet" hint="Snap the Lumiere playbook pages first." action="Snap a guide" onAction={() => go("onboarding")} />
        ) : projects.map((p) => (
          <Card key={p.id} selected={project?.id === p.id} onPress={() => chooseProject(p)}>
            <Text style={T.bold}>{p.name}</Text>
            <Text style={T.muted}>{kindLabel(p)}</Text>
          </Card>
        ))}
        <Text style={T.section}>Brief</Text>
        <TextInput style={T.input} multiline placeholder="Topic, the final answer you want, any source or licence details" placeholderTextColor={C.faint} value={brief} onChangeText={setBrief} />
        <Button title="Draft task" onPress={runDraft} loading={busy} />
        {!!error && <Text style={T.error}>{error}</Text>}
        {!!draft && (
          <Card>
            <Text style={T.section}>Draft</Text>
            <Text selectable style={T.body}>{draft}</Text>
            <Button title="Share draft" kind="ghost" small onPress={() => Share.share({ message: draft }).catch(() => {})} />
          </Card>
        )}
        {overlay}
      </Screen>
    );
  }

  // ================= ONBOARDING =================
  if (step === "onboarding") {
    const justSaved = !!project && pages.length === 0 && project.kind === "images";
    const suggestedReference = buildRecommendedReference(guideName || "New guideline", pages.length || 1);
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title="Onboarding" sub="Snap or upload a guideline, then use it as the reference for the next task." onBack={() => go("welcome")} />
        <Steps total={3} current={justSaved ? 2 : pages.length > 0 ? 1 : 0} labels={["Guide", "Reference", "Compare"]} />
        <TextInput style={T.inputSingle} placeholder="Guide name (optional)" placeholderTextColor={C.faint} value={guideName} onChangeText={setGuideName} />
        <View style={T.row}>
          <Button title={`Snap page${pages.length ? ` (${pages.length})` : ""}`} onPress={snapPage} small />
          <Button title="Upload file" kind="ghost" onPress={uploadFile} small />
        </View>
        {pages.length > 0 && (
          <>
            <View style={styles.pages}>
              {pages.map((uri, i) => (
                <Pressable key={uri + i} onLongPress={() => setPages((p) => p.filter((_, j) => j !== i))} style={styles.page}>
                  <Image source={{ uri }} style={styles.pageImg} resizeMode="cover" />
                  <Text style={styles.pageNum}>{i + 1}</Text>
                </Pressable>
              ))}
            </View>
            <Card>
              <Text style={T.section}>Suggested reference</Text>
              <Text style={T.muted}>{suggestedReference}</Text>
            </Card>
          </>
        )}
        {pages.length > 0 && <Text style={T.muted}>Long-press a page to remove it. Pages are used in this order as the reference flow.</Text>}
        <Button title="Save guide" onPress={saveSnapped} disabled={pages.length === 0} />
        {justSaved && (
          <Card>
            <Text style={T.section}>Saved</Text>
            <Text style={T.bold}>{project!.name} · {kindLabel(project!)}</Text>
            <View style={T.row}>
              <Button title="Compare images" small onPress={() => { setChoice(TASK_MENU[0]); go("capture"); }} />
              <Button title="Compare videos" small kind="ghost" onPress={() => { setChoice(TASK_MENU[1]); go("capture"); }} />
            </View>
          </Card>
        )}
        {overlay}
      </Screen>
    );
  }

  // ================= GUIDES =================
  if (step === "projects") {
    const fromTask = choice.upload && cameFrom === "tasking";
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title="Guides" sub={fromTask ? "Add this project's guidelines, then pick one." : "Guidelines saved on this phone."} onBack={() => go(fromTask ? "tasking" : "welcome")} />
        <View style={T.row}>
          <Button title="Upload file" onPress={uploadFile} small />
          <Button title={pasteMode ? "Cancel" : "Paste text"} kind="ghost" onPress={() => setPasteMode(!pasteMode)} small />
          <Button title="Snap" kind="ghost" onPress={() => go("onboarding")} small />
        </View>
        {pasteMode && (
          <Card>
            <TextInput style={T.inputSingle} placeholder="Guide name" placeholderTextColor={C.faint} value={pasteName} onChangeText={setPasteName} />
            <TextInput style={T.input} multiline placeholder="Paste the guidelines" placeholderTextColor={C.faint} value={pasteText} onChangeText={setPasteText} />
            <Button title="Save guide" onPress={savePasted} />
          </Card>
        )}
        {projects.length === 0 && !pasteMode && (
          <Empty title="No guides yet" hint="Upload a PDF or text file, paste text, or snap the pages with the camera." />
        )}
        {projects.map((p) => (
          <Card key={p.id} selected={p.id === project?.id}>
            <View style={styles.guideRow}>
              <View style={{ flex: 1 }}>
                <Text style={T.bold}>{p.name}</Text>
                <Text style={T.muted}>
                  {kindLabel(p)}{p.id === lastGuideId ? " · last used" : ""}
                </Text>
              </View>
              <Pressable onPress={() => removeProject(p)} hitSlop={8}><Text style={styles.linkDanger}>Delete</Text></Pressable>
            </View>
          </Card>
        ))}
        {projects.length > 0 && fromTask && (
          <Button title="Continue: pick a guide" onPress={() => go("pickProject")} />
        )}
        {overlay}
      </Screen>
    );
  }

  // ================= PICK GUIDE =================
  if (step === "pickProject") {
    const back: Step = choice.stomp ? "stomp" : choice.upload ? "projects" : "tasking";
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title={choice.label} sub="Which guide applies?" onBack={() => go(back)} />
        <Steps total={3} current={0} labels={["Guide", "Capture", "Result"]} />
        {projects.length === 0 && (
          <Empty title="No guides yet" hint="Add one first." action="Add a guide" onAction={() => { setCameFrom("tasking"); go("projects"); }} />
        )}
        {projects.map((p) => (
          <MenuRow
            key={p.id} title={p.name}
            hint={kindLabel(p)}
            badge={p.id === lastGuideId ? "last used" : undefined}
            onPress={async () => {
              await chooseProject(p); go("capture");
            }}
          />
        ))}
        {overlay}
      </Screen>
    );
  }

  // ================= CAPTURE =================
  if (step === "capture") {
    const noGuide = !project;
    const back: Step = noGuide ? "tasking" : choice.stomp ? "pickProject" : "pickProject";
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title={choice.label} sub={project ? `Guide: ${project.name}` : "Using the server's own rules"} onBack={() => go(back)} />
        <Steps total={3} current={1} labels={noGuide ? ["Task", "Capture", "Result"] : ["Guide", "Capture", "Result"]} />
        <Capture
          type={choice.type}
          questionLabel={choice.type === "generation" ? "Generation prompt" : "Question (optional)"}
          question={question}
          setQuestion={setQuestion}
          busy={busy}
          onCompare={runCompare}
        />
        {!!error && <Text style={T.error}>{error}</Text>}
        {overlay}
      </Screen>
    );
  }

  // ================= PAGE ASSISTANT =================
  if (step === "page") {
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title="Page assistant" sub="Answer AI evaluation questions from a webpage screenshot" onBack={() => go("tasking")} />
        <View style={T.row}>
          <Button title="Camera" small onPress={openPageCamera} />
          <Button title="Library" kind="ghost" small onPress={async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) return Alert.alert("Permission needed", "Allow photo access to pick a webpage screenshot.");
            const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
            if (!res.canceled && res.assets?.[0]) {
              setPageImage(res.assets[0].uri);
              await runOcrOnPageImage(res.assets[0].uri);
            }
          }} />
        </View>
        {showCameraPreview && (
          <Card>
            <Text style={T.section}>Frame the page</Text>
            <CameraView ref={cameraRef} style={{ width: "100%", height: 260, borderRadius: 12, overflow: "hidden" }} facing="back" />
            <View style={T.row}>
              <Button title="Snap page" small onPress={capturePageFromCamera} />
              <Button title="Cancel" kind="ghost" small onPress={() => setShowCameraPreview(false)} />
            </View>
          </Card>
        )}
        {pageImage ? (
          <Card>
            <Text style={T.section}>Captured page</Text>
            <Image source={{ uri: pageImage }} style={{ width: "100%", height: 220, borderRadius: 12, backgroundColor: "#111" }} resizeMode="cover" />
          </Card>
        ) : !showCameraPreview && (
          <Empty title="No page captured" hint="Frame the page in camera preview, then snap it, or choose one from your library." />
        )}
        <Text style={T.section}>Question</Text>
        <TextInput
          style={T.input}
          multiline
          placeholder="Examples: Which page has the stronger AI evaluation criteria? What is the visible rubric on this page? How does this page score the model? If the page question is not clear, leave blank and the app will detect it from the screenshot."
          placeholderTextColor={C.faint}
          value={question}
          onChangeText={setQuestion}
        />
        <Button title="Analyze page" onPress={runPageAssistant} loading={busy} disabled={!pageImage} />
        {!!error && <Text style={T.error}>{error}</Text>}
        {!!pageOcrText && (
          <Card>
            <Text style={T.section}>OCR text from page</Text>
            <Text selectable style={T.body}>{pageOcrText}</Text>
          </Card>
        )}
        {!!pageDetectedQuestion && (
          <Card>
            <Text style={T.section}>Detected question</Text>
            <Text selectable style={T.body}>{pageDetectedQuestion}</Text>
          </Card>
        )}
        {!!pageExtractedText && (
          <Card>
            <Text style={T.section}>Extracted page text</Text>
            <Text selectable style={T.body}>{pageExtractedText}</Text>
          </Card>
        )}
        {!!pageAnswer && (
          <Card>
            <Text style={T.section}>Answer</Text>
            <Text selectable style={T.body}>{pageAnswer}</Text>
          </Card>
        )}
        {overlay}
      </Screen>
    );
  }

  // ================= HISTORY =================
  if (step === "history") {
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title="History" sub={history.length ? `${history.length} saved result${history.length === 1 ? "" : "s"}` : undefined} onBack={() => go("welcome")} />
        {history.length === 0 && <Empty title="No results yet" hint="Verdicts are saved here after each comparison." action="Start tasking" onAction={() => go("tasking")} />}
        {history.map((h) => (
          <Card key={h.id} onPress={() => { setVerdict(h.verdict); setLastPair(null); setSwapped(false); go("result"); }}>
            <Text style={T.muted}>{new Date(h.at).toLocaleString()} · {h.task}{h.guide ? ` · ${h.guide}` : ""}</Text>
            <Text style={T.bold}>{winnerLabel(h.verdict)} · {Math.round(h.verdict.confidence * 100)}%</Text>
            <Text style={T.body} numberOfLines={2}>{h.verdict.reason}</Text>
          </Card>
        ))}
        {history.length > 0 && (
          <Button title="Clear history" kind="danger" onPress={() => Alert.alert("Clear history", "Delete all saved results?", [
            { text: "Cancel", style: "cancel" },
            { text: "Clear", style: "destructive", onPress: async () => { await clearHistory(); setHistory([]); say("History cleared"); } },
          ])} />
        )}
        {overlay}
      </Screen>
    );
  }

  // ================= SETTINGS =================
  if (step === "settings") {
    return (
      <Screen nav={nav}>
        <StatusBar style="light" />
        <Header title="Settings" onBack={() => go("welcome")} />
        <Text style={T.section}>Anthropic API key</Text>
        <Text style={T.muted}>Enter the key directly in this app. The app calls Anthropic directly for comparisons and page analysis.</Text>
        <TextInput
          style={T.inputSingle}
          value={anthropicApiKey}
          onChangeText={setAnthropicApiKey}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="sk-ant-..."
          placeholderTextColor={C.faint}
        />
        <View style={T.row}>
          <Button title="Test key" onPress={testConnection} small />
          <Button title="Clear" kind="ghost" onPress={() => setAnthropicApiKey("")} small />
        </View>
        {!!pingNote && <Text style={T.body}>{pingNote}</Text>}
        <Button title="Save API key" onPress={saveSettings} />
        <Text style={T.section}>Access code lock</Text>
        <TextInput
          style={T.inputSingle}
          value={accessCode}
          onChangeText={(text) => {
            setAccessCode(text);
            if (accessError) setAccessError("");
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="TASK-2026-AB12"
          placeholderTextColor={C.faint}
        />
        <View style={T.row}>
          <Button title={accessInfo ? "Update code" : "Activate code"} onPress={activateAccessCode} small />
          {accessInfo && <Button title="Remove" kind="ghost" onPress={clearAccessCode} small />}
        </View>
        {accessInfo && (
          <Text style={T.muted}>
            Active on this mobile: {accessInfo.code} · reset window: {accessInfo.monthKey}
          </Text>
        )}
        <Text style={T.muted}>Guides and results stay on this phone. Each comparison sends the items and the guide directly to Anthropic using the key above.</Text>
        {overlay}
      </Screen>
    );
  }

  // ================= RESULT =================
  const fromHistory = !lastPair;
  return (
    <Screen nav={nav}>
      <StatusBar style="light" />
      <Header title="Result" onBack={() => go(fromHistory ? "history" : "capture")} />
      {!fromHistory && <Steps total={3} current={2} labels={["Guide", "Capture", "Result"]} />}
      {lastPair && (
        <View style={T.row}>
          {(["A", "B"] as const).map((k) => {
            const item = lastPair[k === "A" ? "a" : "b"];
            const won = verdict?.winner === k;
            return (
              <View key={k} style={[styles.preview, won && styles.previewWin]}>
                {item.kind === "image"
                  ? <Image source={{ uri: item.uri }} style={styles.previewImg} resizeMode="cover" />
                  : <View style={[styles.previewImg, styles.centerBox]}><Text style={T.muted}>Video · {Math.round((item.durationMs ?? 0) / 1000)}s</Text></View>}
                <Text style={[T.muted, won && { color: C.text, fontWeight: "700" }]}>Item {k}{won ? " · winner" : ""}</Text>
              </View>
            );
          })}
        </View>
      )}
      {swapped && <Text style={T.muted}>This run had A and B switched. The original A is shown as B.</Text>}
      {verdict && (
        <>
          <Card>
            <Text style={styles.verdict}>{winnerLabel(verdict)}</Text>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(verdict.confidence * 100)}%` }]} /></View>
            <Text style={T.muted}>Confidence {Math.round(verdict.confidence * 100)}%{verdict.confidence < 0.6 ? " · low, treat as a coin flip" : ""}</Text>
            <Text style={T.body}>{verdict.reason}</Text>
          </Card>
          {verdict.criteria.length > 0 && (
            <Card>
              <Text style={T.section}>By criterion</Text>
              {verdict.criteria.map((c, i) => (
                <View key={i} style={styles.crit}>
                  <View style={styles.critHead}>
                    <Text style={[T.bold, { flex: 1 }]}>{c.guideline}</Text>
                    <Text style={styles.pill}>{c.better === "tie" ? "tie" : `${c.better} better`}</Text>
                  </View>
                  <View style={T.row}>
                    <View style={[styles.cell, c.better === "A" && styles.cellWin]}><Text style={T.muted}>A</Text><Text style={T.body}>{c.A || "—"}</Text></View>
                    <View style={[styles.cell, c.better === "B" && styles.cellWin]}><Text style={T.muted}>B</Text><Text style={T.body}>{c.B || "—"}</Text></View>
                  </View>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
      {!!error && <Text style={T.error}>{error}</Text>}
      <View style={T.row}>
        <Button title="Share" onPress={shareVerdict} small disabled={busy} />
        {lastPair && <Button title="Swap and re-run" kind="ghost" onPress={rerunSwapped} small disabled={busy} />}
      </View>
      {lastPair && <Text style={T.muted}>Swap and re-run sends the same pair with A and B switched. A fair judge should flip its answer.</Text>}
      <Button title={fromHistory ? "Start a new comparison" : "Compare another pair"} onPress={() => go(fromHistory ? "tasking" : "capture")} />
      {overlay}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 4, marginBottom: 4 },
  brand: { fontSize: 34, fontWeight: "800", color: C.text, letterSpacing: -0.5 },
  big: { backgroundColor: C.text, padding: 22, borderRadius: 16, gap: 4 },
  bigGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.text },
  bigTitle: { color: "#000", fontSize: 20, fontWeight: "800" },
  bigSub: { color: "#444", fontSize: 13 },
  pressed: { opacity: 0.7 },
  pages: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  page: { width: 72, height: 96, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: C.line },
  pageImg: { width: "100%", height: "100%" },
  pageNum: { position: "absolute", bottom: 4, right: 6, color: C.text, fontWeight: "700", textShadowColor: "#000", textShadowRadius: 4 },
  guideRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  linkDanger: { color: C.muted, textDecorationLine: "underline" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { backgroundColor: "#171717", borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipSelected: { backgroundColor: "#202020", borderColor: C.text },
  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  sourceCard: { width: "48%", borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden", backgroundColor: "#101010" },
  sourceCardSelected: { borderColor: C.text },
  sourceThumb: { width: "100%", height: 120, backgroundColor: "#111" },
  preview: { flex: 1, gap: 4, borderRadius: 10, padding: 4, borderWidth: 2, borderColor: "transparent" },
  previewWin: { borderColor: C.text },
  previewImg: { width: "100%", height: 120, borderRadius: 8, backgroundColor: "#1a1a1a" },
  centerBox: { alignItems: "center", justifyContent: "center" },
  verdict: { fontSize: 22, fontWeight: "800", color: C.text },
  bar: { height: 6, backgroundColor: "#222", borderRadius: 3, overflow: "hidden" },
  barFill: { height: 6, backgroundColor: C.text },
  crit: { borderTopWidth: 1, borderColor: C.line, paddingTop: 10, gap: 8 },
  critHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  pill: { color: C.text, fontSize: 12, borderWidth: 1, borderColor: C.text, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  cell: { flex: 1, gap: 2, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: C.line },
  cellWin: { borderColor: C.text },
});
