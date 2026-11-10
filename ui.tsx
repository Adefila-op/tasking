// Shared building blocks so every screen looks and behaves the same.
import { ReactNode, useEffect, useRef } from "react";
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View,
} from "react-native";

export const C = {
  bg: "#000", card: "#0b0b0b", line: "#262626", text: "#fff", muted: "#9a9a9a", faint: "#666", input: "#111",
};

export function Screen({ children, nav, scroll = true }: { children: ReactNode; nav?: ReactNode; scroll?: boolean }) {
  const body = scroll ? (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">{children}</ScrollView>
  ) : (
    <View style={[styles.flex, styles.container]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {body}
      </KeyboardAvoidingView>
      {nav}
    </SafeAreaView>
  );
}

export function Header({ title, sub, onBack }: { title: string; sub?: string; onBack?: () => void }) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={10} style={styles.back}><Text style={styles.backText}>‹ Back</Text></Pressable>
      )}
      <Text style={styles.title}>{title}</Text>
      {!!sub && <Text style={styles.muted}>{sub}</Text>}
    </View>
  );
}

// Dots like "● ● ○" so the user knows where they are in a flow.
export function Steps({ total, current, labels }: { total: number; current: number; labels?: string[] }) {
  return (
    <View style={styles.steps}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={styles.step}>
          <View style={[styles.dot, i <= current && styles.dotOn]} />
          {labels?.[i] && <Text style={[styles.stepLabel, i === current && styles.stepLabelOn]}>{labels[i]}</Text>}
        </View>
      ))}
    </View>
  );
}

type Kind = "primary" | "ghost" | "danger";
export function Button({ title, onPress, kind = "primary", disabled, small, loading }: {
  title: string; onPress: () => void; kind?: Kind; disabled?: boolean; small?: boolean; loading?: boolean;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.btn, small && styles.btnSmall,
        kind === "ghost" && styles.btnGhost, kind === "danger" && styles.btnDanger,
        off && styles.disabled, pressed && !off && styles.pressed,
      ]}
    >
      {loading ? <ActivityIndicator color={kind === "primary" ? "#000" : "#fff"} /> : (
        <Text style={[styles.btnText, kind !== "primary" && styles.btnTextLight]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, onPress, selected }: { children: ReactNode; onPress?: () => void; selected?: boolean }) {
  if (!onPress) return <View style={[styles.card, selected && styles.cardOn]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, selected && styles.cardOn, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

// A row with a number badge, title and hint. Used for menus.
export function MenuRow({ n, title, hint, onPress, badge }: { n?: string; title: string; hint: string; onPress: () => void; badge?: string }) {
  return (
    <Card onPress={onPress}>
      <View style={styles.menuRow}>
        {!!n && <View style={styles.num}><Text style={styles.numText}>{n}</Text></View>}
        <View style={styles.flex}>
          <Text style={styles.bold}>{title}</Text>
          <Text style={styles.muted}>{hint}</Text>
        </View>
        {!!badge && <Text style={styles.badge}>{badge}</Text>}
        <Text style={styles.chev}>›</Text>
      </View>
    </Card>
  );
}

export function Empty({ title, hint, action, onAction }: { title: string; hint: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.bold}>{title}</Text>
      <Text style={[styles.muted, { textAlign: "center" }]}>{hint}</Text>
      {action && onAction && <Button title={action} onPress={onAction} small />}
    </View>
  );
}

export function Toast({ message }: { message: string }) {
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!message) return;
    Animated.sequence([
      Animated.timing(op, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(op, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [message, op]);
  if (!message) return null;
  return (
    <Animated.View style={[styles.toast, { opacity: op }]} pointerEvents="none">
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
}

export function Progress({ stage }: { stage: string }) {
  if (!stage) return null;
  return (
    <View style={styles.overlay}>
      <View style={styles.overlayBox}>
        <ActivityIndicator color="#fff" size="large" />
        <Text style={styles.overlayText}>{stage}</Text>
      </View>
    </View>
  );
}

export type NavKey = "home" | "guides" | "history" | "settings";
export function BottomNav({ active, onGo }: { active: NavKey; onGo: (k: NavKey) => void }) {
  const items: { k: NavKey; label: string; icon: string }[] = [
    { k: "home", label: "Home", icon: "⌂" }, { k: "guides", label: "Guides", icon: "≡" },
    { k: "history", label: "History", icon: "◷" }, { k: "settings", label: "Settings", icon: "⚙" },
  ];
  return (
    <View style={styles.nav}>
      {items.map((it) => (
        <Pressable key={it.k} onPress={() => onGo(it.k)} style={styles.navItem} hitSlop={6}>
          <Text style={[styles.navIcon, active === it.k && styles.navOn]}>{it.icon}</Text>
          <Text style={[styles.navLabel, active === it.k && styles.navOn]}>{it.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const T = StyleSheet.create({
  bold: { fontWeight: "600", color: C.text, fontSize: 15 },
  body: { fontSize: 14, color: "#ddd", lineHeight: 20 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 18 },
  error: { color: "#fff", backgroundColor: "#2a1111", borderWidth: 1, borderColor: "#5a2a2a", padding: 10, borderRadius: 8 },
  input: { borderWidth: 1, borderColor: C.line, backgroundColor: C.input, color: C.text, borderRadius: 10, padding: 12, minHeight: 110, textAlignVertical: "top", fontSize: 15 },
  inputSingle: { borderWidth: 1, borderColor: C.line, backgroundColor: C.input, color: C.text, borderRadius: 10, padding: 12, fontSize: 15 },
  row: { flexDirection: "row", gap: 8 },
  section: { fontSize: 13, fontWeight: "600", color: C.muted, textTransform: "uppercase", letterSpacing: 1, marginTop: 8 },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: C.bg },
  container: { padding: 16, paddingTop: 24, paddingBottom: 32, gap: 12 },
  header: { gap: 4, marginBottom: 4 },
  back: { alignSelf: "flex-start", paddingVertical: 4 },
  backText: { color: C.muted, fontSize: 15 },
  title: { fontSize: 26, fontWeight: "700", color: C.text },
  muted: { color: C.muted, fontSize: 13 },
  bold: { fontWeight: "600", color: C.text, fontSize: 15 },
  steps: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  step: { alignItems: "center", gap: 4, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.line },
  dotOn: { backgroundColor: C.text },
  stepLabel: { color: C.faint, fontSize: 11, textAlign: "center" },
  stepLabelOn: { color: C.text },
  btn: { backgroundColor: C.text, paddingVertical: 15, paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 50 },
  btnSmall: { paddingVertical: 11, minHeight: 42, flex: 1 },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.text },
  btnDanger: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#5a2a2a" },
  btnText: { color: "#000", fontWeight: "700", fontSize: 15 },
  btnTextLight: { color: C.text },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  card: { borderWidth: 1, borderColor: C.line, backgroundColor: C.card, borderRadius: 12, padding: 14, gap: 6 },
  cardOn: { borderColor: C.text },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  num: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: C.text, alignItems: "center", justifyContent: "center" },
  numText: { color: C.text, fontWeight: "700" },
  chev: { color: C.faint, fontSize: 22 },
  badge: { color: C.muted, fontSize: 11, borderWidth: 1, borderColor: C.line, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  empty: { alignItems: "center", gap: 10, padding: 24, borderWidth: 1, borderColor: C.line, borderStyle: "dashed", borderRadius: 12 },
  toast: { position: "absolute", bottom: 90, alignSelf: "center", backgroundColor: "#222", borderWidth: 1, borderColor: "#444", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  toastText: { color: C.text, fontWeight: "600" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 24 },
  overlayBox: { alignItems: "center", gap: 14, padding: 24, borderRadius: 16, backgroundColor: "#111", borderWidth: 1, borderColor: C.line, minWidth: 240 },
  overlayText: { color: C.text, textAlign: "center", fontSize: 15 },
  nav: { flexDirection: "row", borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg, paddingVertical: 6 },
  navItem: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 4 },
  navIcon: { color: C.faint, fontSize: 18 },
  navLabel: { color: C.faint, fontSize: 11 },
  navOn: { color: C.text },
});
