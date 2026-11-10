// Guideline projects: a PDF, a text file, or a set of photographed pages.
// Files live in the app's document directory; a small JSON index lists them.
import * as FileSystem from "expo-file-system/legacy";

export type Project = {
  id: string;
  name: string;
  kind: "pdf" | "text" | "images";
  path: string;        // pdf or text file; for images, the first page
  paths?: string[];    // page files for kind "images"
  addedAt: number;
};

export type GuidelineSource =
  | { kind: "pdf"; base64: string }
  | { kind: "text"; text: string }
  | { kind: "images"; images: string[] };

const DIR = `${FileSystem.documentDirectory}guidelines/`;
const INDEX = `${DIR}index.json`;

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

export async function listProjects(): Promise<Project[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(INDEX);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveIndex(projects: Project[]) {
  await ensureDir();
  await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(projects));
}

function newId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Strips HTML to readable text so the model reads the guide's content, not its markup.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

// Copies any readable URI by re-encoding through base64. copyAsync rejects some
// Android content:// URIs returned by the document and image pickers; this path works for them.
async function copyBytes(from: string, to: string) {
  const b64 = await FileSystem.readAsStringAsync(from, { encoding: FileSystem.EncodingType.Base64 });
  await FileSystem.writeAsStringAsync(to, b64, { encoding: FileSystem.EncodingType.Base64 });
}

export async function addProjectFromFile(name: string, uri: string, fileName: string): Promise<Project> {
  await ensureDir();
  const id = newId();
  const lower = fileName.toLowerCase();
  let project: Project;

  if (lower.endsWith(".pdf")) {
    const path = `${DIR}${id}.pdf`;
    await copyBytes(uri, path);
    project = { id, name: name || fileName, kind: "pdf", path, addedAt: Date.now() };
  } else {
    const path = `${DIR}${id}.txt`;
    const raw = await FileSystem.readAsStringAsync(uri);
    const text = lower.endsWith(".html") || lower.endsWith(".htm") ? htmlToText(raw) : raw;
    await FileSystem.writeAsStringAsync(path, text);
    project = { id, name: name || fileName, kind: "text", path, addedAt: Date.now() };
  }

  await saveIndex([...(await listProjects()), project]);
  return project;
}

export async function addProjectFromText(name: string, text: string): Promise<Project> {
  await ensureDir();
  const id = newId();
  const path = `${DIR}${id}.txt`;
  await FileSystem.writeAsStringAsync(path, text);
  const project: Project = { id, name, kind: "text", path, addedAt: Date.now() };
  await saveIndex([...(await listProjects()), project]);
  return project;
}

// Saves photographed guideline pages (camera photos, in page order).
export async function addProjectFromPhotos(name: string, uris: string[]): Promise<Project> {
  await ensureDir();
  const id = newId();
  const paths: string[] = [];
  for (let i = 0; i < uris.length; i++) {
    const path = `${DIR}${id}-${i + 1}.jpg`;
    await copyBytes(uris[i], path);
    paths.push(path);
  }
  const project: Project = { id, name, kind: "images", path: paths[0], paths, addedAt: Date.now() };
  await saveIndex([...(await listProjects()), project]);
  return project;
}

export async function deleteProject(id: string) {
  const projects = await listProjects();
  const target = projects.find((p) => p.id === id);
  if (target) {
    for (const path of target.paths ?? [target.path]) {
      await FileSystem.deleteAsync(path, { idempotent: true });
    }
  }
  await saveIndex(projects.filter((p) => p.id !== id));
}

export async function loadGuidelines(project: Project): Promise<GuidelineSource> {
  if (project.kind === "pdf") {
    return { kind: "pdf", base64: await FileSystem.readAsStringAsync(project.path, { encoding: FileSystem.EncodingType.Base64 }) };
  }
  if (project.kind === "images") {
    const images: string[] = [];
    for (const path of project.paths ?? [project.path]) {
      images.push(await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 }));
    }
    return { kind: "images", images };
  }
  return { kind: "text", text: await FileSystem.readAsStringAsync(project.path) };
}
