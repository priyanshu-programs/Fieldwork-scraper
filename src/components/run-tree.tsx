"use client";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  Edit02Icon,
  File01Icon,
  Folder01Icon,
  FolderAddIcon,
  FolderLibraryIcon,
  FolderOpenIcon,
  InboxIcon,
} from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Folder, Run } from "@/lib/types";
import BranchedMenu, {
  type BranchedEdit,
  type BranchedItem,
} from "./branched-menu";

/** Light run record returned by GET /api/folders for the tree. */
export type RunEntry = Pick<
  Run,
  "id" | "title" | "status" | "folder_id" | "created_at"
>;
export interface Confirmation {
  title: string;
  body: string;
  action: string;
  run: () => Promise<void>;
}

/** Folders in depth-first order with their depth, for indented selects. */
export function folderOrder(folders: Folder[]) {
  const kids = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const list = kids.get(f.parent_id) ?? [];
    list.push(f);
    kids.set(f.parent_id, list);
  }
  const out: { folder: Folder; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of kids.get(parent) ?? []) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** "Research / Pricing" style path for a folder. */
export function folderPath(folders: Folder[], id: string | null) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  let f = id ? byId.get(id) : undefined;
  while (f && names.length < 50) {
    names.unshift(f.name);
    f = f.parent_id ? byId.get(f.parent_id) : undefined;
  }
  return names.join(" / ");
}

export function FolderOptions({ folders }: { folders: Folder[] }) {
  return (
    <>
      <option value="">Unfiled</option>
      {folderOrder(folders).map(({ folder, depth }) => (
        <option key={folder.id} value={folder.id}>
          {"   ".repeat(depth) + folder.name}
        </option>
      ))}
    </>
  );
}

/** In-page confirmation; the viewer never relies on window.confirm. */
export function ConfirmPanel({
  confirm,
  onCancel,
}: {
  confirm: Confirmation | null;
  onCancel: () => void;
}) {
  const [working, setWorking] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) ref.current?.focus();
  }, [confirm]);
  if (!confirm) return null;
  return (
    <div
      className="confirm-panel"
      role="alertdialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div>
        <strong id="confirm-title">{confirm.title}</strong>
        <p id="confirm-body">{confirm.body}</p>
      </div>
      <div className="confirm-actions">
        <button
          ref={ref}
          className="danger"
          disabled={working}
          aria-busy={working}
          onClick={async () => {
            setWorking(true);
            try {
              await confirm.run();
            } finally {
              setWorking(false);
            }
          }}
        >
          {working ? "Working…" : confirm.action}
        </button>
        <button className="secondary" disabled={working} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const OPEN_KEY = "fieldwork.tree.open";
/** Drag payload for runs: a JSON array of run ids (tree rows and table rows). */
export const RUN_DRAG = "application/x-fieldwork-runs";
/** Drag payload for one folder being reordered or moved: its id. */
export const FOLDER_DRAG = "application/x-fieldwork-folder";
export function readRunDrag(data: string): string[] {
  try {
    const ids = JSON.parse(data);
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default function RunTree({
  folders,
  runs,
  folder,
  run,
  onNavigate,
  onChanged,
  onError,
  onConfirm,
  onDeleteRuns,
  onMoveRuns,
  api,
}: {
  folders: Folder[];
  runs: RunEntry[];
  folder: string;
  run: string | null;
  onNavigate: (values: Record<string, string>) => void;
  onChanged: () => void;
  onError: (message: string) => void;
  onConfirm: (c: Confirmation) => void;
  onDeleteRuns: (ids: string[], label: string) => void;
  onMoveRuns: (ids: string[], folderId: string | null) => void;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
}) {
  const [open, setOpen] = useState<string[]>(["root"]);
  const [edit, setEdit] = useState<BranchedEdit>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) || "null");
      if (Array.isArray(saved)) setOpen(saved.map(String));
    } catch {}
  }, []);
  const saveOpen = (next: string[]) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {}
  };
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  // Keep the folder holding the current selection visible.
  const runFolder = run ? runs.find((r) => r.id === run)?.folder_id : undefined;
  useEffect(() => {
    const need: string[] = [];
    let f = folder && folder !== "root" ? byId.get(folder) : undefined;
    if (run) {
      if (runFolder === null) need.push("root");
      f = runFolder ? byId.get(runFolder) : f;
      if (f) need.push("f:" + f.id);
    }
    f = f?.parent_id ? byId.get(f.parent_id) : undefined;
    while (f && need.length < 50) {
      need.push("f:" + f.id);
      f = f.parent_id ? byId.get(f.parent_id) : undefined;
    }
    const missing = need.filter((v) => !open.includes(v));
    if (missing.length) saveOpen([...open, ...missing]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, run, runFolder, byId]);
  const items = useMemo(() => {
    const runItem = (r: RunEntry): BranchedItem => ({
      value: "r:" + r.id,
      label: r.title,
      kind: "run",
      icon: File01Icon,
      status: r.status,
    });
    const runsIn = new Map<string | null, RunEntry[]>();
    for (const r of runs) {
      const list = runsIn.get(r.folder_id) ?? [];
      list.push(r);
      runsIn.set(r.folder_id, list);
    }
    const sub = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const list = sub.get(f.parent_id) ?? [];
      list.push(f);
      sub.set(f.parent_id, list);
    }
    const node = (f: Folder): BranchedItem => ({
      value: "f:" + f.id,
      label: f.name,
      kind: "folder",
      icon: Folder01Icon,
      openIcon: FolderOpenIcon,
      badge: f.run_count || undefined,
      children: [
        ...(sub.get(f.id) ?? []).map(node),
        ...(runsIn.get(f.id) ?? []).map(runItem),
      ],
    });
    const unfiled = runsIn.get(null) ?? [];
    return [
      {
        value: "all",
        label: "All runs",
        icon: FolderLibraryIcon,
        badge: runs.length || undefined,
      },
      ...(sub.get(null) ?? []).map(node),
      {
        value: "root",
        label: "Unfiled",
        kind: "folder",
        icon: InboxIcon,
        badge: unfiled.length || undefined,
        children: unfiled.map(runItem),
      },
    ] as BranchedItem[];
  }, [folders, runs]);
  const active = run
    ? "r:" + run
    : folder === "root"
      ? "root"
      : folder
        ? "f:" + folder
        : "all";
  const select = (value: string) => {
    if (value === "all")
      onNavigate({ view: "history", folder: "", run: "", page: "" });
    else if (value === "root")
      onNavigate({ view: "history", folder: "root", run: "", page: "" });
    else if (value.startsWith("f:"))
      onNavigate({
        view: "history",
        folder: value.slice(2),
        run: "",
        page: "",
      });
    else onNavigate({ view: "history", run: value.slice(2) });
  };
  const save = async (name: string) => {
    const current = edit;
    setEdit(null);
    try {
      if (current?.kind === "create") {
        await api("folders", {
          method: "POST",
          // edit.parent holds the tree value ("f:<id>"), not the folder id.
          body: JSON.stringify({
            name,
            parent_id: current.parent ? current.parent.slice(2) : null,
          }),
        });
        if (current.parent && !open.includes(current.parent))
          saveOpen([...open, current.parent]);
      } else if (current?.kind === "rename")
        await api("folders/" + current.value.slice(2), {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const deleteFolder = (f: Folder) => {
    const parent = f.parent_id ? byId.get(f.parent_id)?.name : null;
    onConfirm({
      title: `Delete folder “${f.name}”?`,
      body: `Its runs and subfolders are kept and move to ${parent ? `“${parent}”` : "the top level"}. Nothing is deleted except the folder.`,
      action: "Delete folder",
      run: async () => {
        await api("folders/" + f.id, { method: "DELETE" });
        if (folder === f.id)
          onNavigate({ view: "history", folder: f.parent_id || "", page: "" });
        onChanged();
      },
    });
  };
  /** True when `id` is `ancestor` or sits anywhere inside it. */
  const within = (id: string | null, ancestor: string) => {
    for (let f = id ? byId.get(id) : undefined, n = 0; f && n < 100; n++) {
      if (f.id === ancestor) return true;
      f = f.parent_id ? byId.get(f.parent_id) : undefined;
    }
    return false;
  };
  const siblingsOf = (f: Folder) =>
    folders.filter((x) => x.parent_id === f.parent_id);
  const moveFolder = async (
    id: string,
    to: { parent_id: string | null; before_id?: string; after_id?: string },
  ) => {
    try {
      await api(`folders/${id}/move`, {
        method: "POST",
        body: JSON.stringify(to),
      });
      if (to.parent_id && !open.includes("f:" + to.parent_id))
        saveOpen([...open, "f:" + to.parent_id]);
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const keyAction = (
    action: "rename" | "delete" | "moveUp" | "moveDown",
    item: BranchedItem,
  ) => {
    if (item.value.startsWith("f:")) {
      const f = byId.get(item.value.slice(2));
      if (!f) return;
      if (action === "rename") setEdit({ kind: "rename", value: item.value });
      else if (action === "delete") deleteFolder(f);
      else {
        // Alt+Up / Alt+Down: swap with the neighbour among siblings.
        const list = siblingsOf(f);
        const i = list.findIndex((x) => x.id === f.id);
        const other = list[action === "moveUp" ? i - 1 : i + 1];
        if (other)
          void moveFolder(f.id, {
            parent_id: f.parent_id,
            ...(action === "moveUp"
              ? { before_id: other.id }
              : { after_id: other.id }),
          });
      }
    } else if (item.value.startsWith("r:") && action === "delete") {
      const r = runs.find((x) => x.id === item.value.slice(2));
      if (r && r.status !== "running") onDeleteRuns([r.id], `“${r.title}”`);
    }
  };
  const actionButton = (
    label: string,
    icon: typeof Delete02Icon,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      tabIndex={-1}
      className="bm-action"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <HugeiconsIcon icon={icon} size={15} />
    </button>
  );
  return (
    <div className="tree-panel">
      <div className="tree-head">
        <h2>Folders</h2>
        <button
          type="button"
          className="text-button"
          onClick={() => setEdit({ kind: "create", parent: null })}
        >
          <HugeiconsIcon icon={FolderAddIcon} size={16} aria-hidden="true" />
          New folder
        </button>
      </div>
      <BranchedMenu
        label="Folders and runs"
        items={items}
        active={active}
        open={open}
        onOpenChange={saveOpen}
        onSelect={select}
        edit={edit}
        onCommitEdit={save}
        onCancelEdit={() => setEdit(null)}
        onKeyAction={keyAction}
        dragTypes={[FOLDER_DRAG, RUN_DRAG]}
        dragData={(item) =>
          item.value.startsWith("r:")
            ? { type: RUN_DRAG, data: JSON.stringify([item.value.slice(2)]) }
            : item.value.startsWith("f:")
              ? { type: FOLDER_DRAG, data: item.value.slice(2) }
              : null
        }
        dropZones={(item, drag) => {
          const isFolder = item.value.startsWith("f:");
          if (drag.types.includes(FOLDER_DRAG)) {
            // Folders: between folders to reorder, or inside another folder.
            const source = drag.source?.startsWith("f:")
              ? drag.source.slice(2)
              : null;
            if (!isFolder || !source) return null;
            const target = item.value.slice(2);
            if (within(target, source)) return null;
            return { inside: true, between: true };
          }
          if (drag.types.includes(RUN_DRAG))
            return isFolder || item.value === "root" ? { inside: true } : null;
          return null;
        }}
        onDropData={(item, place, drag) => {
          if (drag.type === FOLDER_DRAG) {
            const source = drag.data;
            const target = byId.get(item.value.slice(2));
            if (!target || within(target.id, source)) return;
            if (place === "inside")
              void moveFolder(source, { parent_id: target.id });
            else
              void moveFolder(source, {
                parent_id: target.parent_id,
                ...(place === "before"
                  ? { before_id: target.id }
                  : { after_id: target.id }),
              });
            return;
          }
          const dest = item.value === "root" ? null : item.value.slice(2);
          const ids = readRunDrag(drag.data).filter(
            (id) => runs.find((r) => r.id === id)?.folder_id !== dest,
          );
          if (!ids.length) return;
          onMoveRuns(ids, dest);
          if (item.value !== "root" && !open.includes(item.value))
            saveOpen([...open, item.value]);
        }}
        renderActions={(item) => {
          if (item.value.startsWith("f:")) {
            const f = byId.get(item.value.slice(2));
            if (!f) return null;
            return (
              <>
                {actionButton("New subfolder", FolderAddIcon, () => {
                  if (!open.includes(item.value))
                    saveOpen([...open, item.value]);
                  setEdit({ kind: "create", parent: item.value });
                })}
                {actionButton("Rename folder", Edit02Icon, () =>
                  setEdit({ kind: "rename", value: item.value }),
                )}
                {actionButton("Delete folder", Delete02Icon, () =>
                  deleteFolder(f),
                )}
              </>
            );
          }
          if (item.value.startsWith("r:")) {
            const r = runs.find((x) => x.id === item.value.slice(2));
            if (!r) return null;
            return actionButton(
              r.status === "running"
                ? "Running runs cannot be deleted"
                : "Delete run",
              Delete02Icon,
              () => onDeleteRuns([r.id], `“${r.title}”`),
              r.status === "running",
            );
          }
          return null;
        }}
      />
      <p className="small muted tree-hint">
        Drag runs onto a folder to file them. Drag a folder to reorder it, or
        onto another folder to nest it (Alt+↑/↓ also reorders). F2 renames.
      </p>
    </div>
  );
}
