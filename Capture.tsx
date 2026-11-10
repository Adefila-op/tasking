// Camera screen: record or capture two items (A and B), then compare.
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { MediaItem, TaskType } from "./compare";

type Props = {
  type: TaskType;
  questionLabel: string;
  question: string;
  setQuestion: (s: string) => void;
  busy: boolean;
  onCompare: (a: MediaItem, b: MediaItem) => void;
};

type SlotId = "A" | "B";

export default function Capture({ type, questionLabel, question, setQuestion, busy, onCompare }: Props) {
  const isVideo = type === "video";
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const camRef = useRef<CameraView>(null);
  const [active, setActive] = useState<SlotId>("A");
  const [items, setItems] = useState<Record<SlotId, MediaItem | null>>({ A: null, B: null });
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState("");
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [thumbs, setThumbs] = useState<Record<SlotId, string | null>>({ A: null, B: null });
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  const put = (slot: SlotId, item: MediaItem) => {
    setItems((s) => ({ ...s, [slot]: item }));
    setThumbs((t) => ({ ...t, [slot]: item.kind === "image" ? item.uri : null }));
    if (item.kind === "video") {
      const time = Math.max(0, Math.round((item.durationMs ?? 0) * 0.35));
      VideoThumbnails.getThumbnailAsync(item.uri, { time, quality: 0.4 })
        .then((r) => setThumbs((t) => ({ ...t, [slot]: r.uri })))
        .catch(() => {});
    }
    // move to the empty slot so the next capture fills it
    const other: SlotId = slot === "A" ? "B" : "A";
    if (!items[other]) setActive(other);
  };

  const clear = (slot: SlotId) => {
    setItems((s) => ({ ...s, [slot]: null }));
    setThumbs((t) => ({ ...t, [slot]: null }));
    setActive(slot);
  };

  const swap = () => {
    setItems((s) => ({ A: s.B, B: s.A }));
    setThumbs((t) => ({ A: t.B, B: t.A }));
  };

  // recording timer shown on the camera
  useEffect(() => {
    if (!recording) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 500);
    return () => clearInterval(id);
  }, [recording]);

  const ensurePerms = async () => {
    if (!camPerm?.granted) {
      const r = await requestCam();
      if (!r.granted) return false;
    }
    if (isVideo && !micPerm?.granted) {
      const r = await requestMic();
      if (!r.granted) return false;
    }
    return true;
  };

  const record = async () => {
    if (!(await ensurePerms()) || !camRef.current) return setNote("Camera permission is needed.");
    const slot = active; // capture the slot now, the user may tap the other one while recording
    setNote("");
    startedAt.current = Date.now();
    setRecording(true);
    try {
      const v = await camRef.current.recordAsync({ maxDuration: 30 });
      if (v?.uri) put(slot, { uri: v.uri, kind: "video", durationMs: Date.now() - startedAt.current });
    } catch (e: any) {
      setNote(e?.message || "Recording failed.");
    } finally {
      setRecording(false);
    }
  };

  const stop = () => camRef.current?.stopRecording();

  const snap = async () => {
    if (!(await ensurePerms()) || !camRef.current) return setNote("Camera permission is needed.");
    try {
      const pic = await camRef.current.takePictureAsync({ quality: 0.7 });
      if (pic?.uri) put(active, { uri: pic.uri, kind: "image" });
    } catch (e: any) {
      setNote(e?.message || "Capture failed.");
    }
  };

  const fromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setNote("Library permission is needed.");
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: isVideo ? ["videos"] : ["images"],
      quality: 0.7,
      videoMaxDuration: 30,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    put(active, { uri: asset.uri, kind: asset.type === "video" ? "video" : "image", durationMs: asset.duration ?? undefined });
  };

  if (!camPerm) return <ActivityIndicator />;
  if (!camPerm.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Camera access lets you record the screen you want to compare.</Text>
        <Pressable style={styles.btn} onPress={requestCam}><Text style={styles.btnText}>Allow camera</Text></Pressable>
      </View>
    );
  }

  const current = items[active];
  const ready = !!items.A && !!items.B && !busy;

  return (
    <View style={[styles.wrap, { backgroundColor: "#000" }]}>
      <View style={styles.cameraBox}>
        <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing={facing} mode={isVideo ? "video" : "picture"} />
        <View style={styles.guide} pointerEvents="none">
          <Text style={styles.guideText}>{isVideo ? `Recording fills Item ${active} · max 30s` : `Capture fills Item ${active}`}</Text>
        </View>
        {recording && <View style={styles.recDot}><Text style={styles.recText}>● REC {elapsed}s</Text></View>}
        {!recording && (
          <Pressable style={styles.flip} onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}>
            <Text style={styles.recText}>Flip</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.pair}>
        {(["A", "B"] as SlotId[]).map((slot) => {
          const item = items[slot];
          const on = active === slot;
          const thumb = thumbs[slot];
          return (
            <Pressable key={slot} onPress={() => setActive(slot)} style={[styles.slot, on && styles.slotOn]}>
              <View style={styles.slotHead}>
                <Text style={styles.slotLabel}>Item {slot}{on ? " · next" : ""}</Text>
                {item && <Pressable onPress={() => clear(slot)} hitSlop={8}><Text style={styles.clear}>Clear</Text></Pressable>}
              </View>
              {thumb ? (
                <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.center]}>
                  <Text style={styles.muted}>{item ? "Video" : "Empty"}</Text>
                </View>
              )}
              {item?.kind === "video" && <Text style={styles.muted}>Video · {Math.round((item.durationMs ?? 0) / 1000)}s</Text>}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.row}>
        {isVideo ? (
          recording ? (
            <Pressable style={[styles.btn, styles.btnStop]} onPress={stop}><Text style={styles.btnDarkText}>Stop</Text></Pressable>
          ) : (
            <Pressable style={[styles.btn, busy && styles.disabled]} onPress={record} disabled={busy}><Text style={styles.btnText}>Record {active}</Text></Pressable>
          )
        ) : (
          <Pressable style={[styles.btn, busy && styles.disabled]} onPress={snap} disabled={busy}><Text style={styles.btnText}>Capture {active}</Text></Pressable>
        )}
        <Pressable style={[styles.btnGhost, (recording || busy) && styles.disabled]} onPress={fromLibrary} disabled={recording || busy}>
          <Text style={styles.btnGhostText}>Library</Text>
        </Pressable>
      </View>
      {items.A && items.B ? (
        <View style={styles.rowBetween}>
          <Text style={styles.muted}>Both items ready.</Text>
          <Pressable onPress={swap} hitSlop={8}><Text style={styles.clear}>Swap A and B</Text></Pressable>
        </View>
      ) : (
        <Text style={styles.muted}>{current ? `Item ${active} is set; capturing again replaces it.` : `Next capture goes to Item ${active}.`}</Text>
      )}
      {!!note && <Text style={styles.error}>{note}</Text>}

      <Text style={styles.label}>{questionLabel}</Text>
      <TextInput
        style={styles.input}
        multiline
        placeholder={type === "generation" ? "The prompt the images were generated from" : "Optional: the question for this comparison"}
        placeholderTextColor="#666"
        value={question}
        onChangeText={setQuestion}
      />

      <Pressable style={[styles.btn, !ready && styles.disabled]} disabled={!ready} onPress={() => items.A && items.B && onCompare(items.A, items.B)}>
        {busy ? <Text style={styles.btnText}>Comparing… this can take a minute</Text> : <Text style={styles.btnText}>Compare A and B</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  center: { alignItems: "center", justifyContent: "center", gap: 10, padding: 16 },
  cameraBox: { height: 320, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  guide: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "flex-end", padding: 12 },
  guideText: { color: "#fff", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  recDot: { position: "absolute", top: 10, left: 10, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  recText: { color: "#fff", fontWeight: "700" },
  flip: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  slotHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  clear: { color: "#fff", textDecorationLine: "underline", fontSize: 13 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pair: { flexDirection: "row", gap: 10 },
  slot: { flex: 1, borderWidth: 2, borderColor: "#333", borderRadius: 10, padding: 8, gap: 6 },
  slotOn: { borderColor: "#fff" },
  slotLabel: { fontWeight: "600", color: "#fff" },
  thumb: { width: "100%", height: 90, borderRadius: 6, backgroundColor: "#1a1a1a" },
  row: { flexDirection: "row", gap: 8 },
  label: { fontWeight: "600", marginTop: 6, color: "#fff" },
  input: { borderWidth: 1, borderColor: "#333", backgroundColor: "#111", color: "#fff", borderRadius: 8, padding: 10, minHeight: 70, textAlignVertical: "top" },
  btn: { flex: 1, backgroundColor: "#fff", padding: 14, borderRadius: 10, alignItems: "center" },
  btnStop: { backgroundColor: "#333", borderWidth: 1, borderColor: "#fff" },
  btnText: { color: "#000", fontWeight: "600" },
  btnDarkText: { color: "#fff", fontWeight: "600" },
  btnGhost: { paddingHorizontal: 16, borderWidth: 1, borderColor: "#fff", borderRadius: 10, justifyContent: "center" },
  btnGhostText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.5 },
  error: { color: "#fff", fontWeight: "600" },
  muted: { color: "#999", fontSize: 13 },
});
