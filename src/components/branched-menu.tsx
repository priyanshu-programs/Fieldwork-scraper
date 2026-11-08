"use client";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/**
 * A file-tree menu with drawn branch lines. Adapted from the owner's
 * BranchedMenu snippet: any depth, controlled active/open state, row actions,
 * inline rename/create and full tree keyboard support.
 */
export interface BranchedItem {
  value: string;
  label: string;
  icon?: IconSvgElement;
  openIcon?: IconSvgElement;
  kind?: "folder" | "run";
  badge?: ReactNode;
  status?: string;
  children?: BranchedItem[];
}
export type DropPlace = "before" | "inside" | "after";
export type BranchedEdit =
  | { kind: "rename"; value: string }
  | { kind: "create"; parent: string | null }
  | null;
interface Props {
  items: BranchedItem[];
  label?: string;
  active?: string | null;
  defaultActive?: string;
  open?: string[];
  defaultOpen?: string[];
  onOpenChange?: (open: string[]) => void;
  onSelect?: (value: string, item: BranchedItem) => void;
  renderActions?: (item: BranchedItem) => ReactNode;
  onKeyAction?: (
    action: "rename" | "delete" | "moveUp" | "moveDown",
    item: BranchedItem,
  ) => void;
  edit?: BranchedEdit;
  onCommitEdit?: (name: string) => void;
  onCancelEdit?: () => void;
  /**
   * Drag and drop. A row may carry one typed payload; a target says whether a
   * drag may land inside it and/or between rows (before/after it).
   */
  dragTypes?: string[];
  dragData?: (item: BranchedItem) => { type: string; data: string } | null;
  dropZones?: (
    target: BranchedItem,
    drag: { types: readonly string[]; source: string | null },
  ) => { inside?: boolean; between?: boolean } | null;
  onDropData?: (
    target: BranchedItem,
    place: DropPlace,
    drag: { type: string; data: string },
  ) => void;
  color?: string;
  accentColor?: string;
  lineColor?: string;
  width?: number | string;
  rowHeight?: number;
  indent?: number;
  trunk?: number;
  radius?: number;
  lineWidth?: number;
  fontSize?: number;
  drawDuration?: number;
  foldDuration?: number;
}
const hasChildren = (i: BranchedItem) =>
  i.kind === "folder" || !!i.children?.length;

export default function BranchedMenu({
  items,
  label = "Folders",
  active: activeProp,
  defaultActive,
  open: openProp,
  defaultOpen = [],
  onOpenChange,
  onSelect,
  renderActions,
  onKeyAction,
  edit = null,
  onCommitEdit,
  onCancelEdit,
  dragTypes = [],
  dragData,
  dropZones,
  onDropData,
  color = "var(--color-ink-2)",
  accentColor = "var(--color-accent)",
  lineColor = "var(--color-rule)",
  width = "100%",
  rowHeight = 34,
  indent = 26,
  trunk = 13,
  radius = 8,
  lineWidth = 1.5,
  fontSize = 15,
  drawDuration = 400,
  foldDuration = 300,
}: Props) {
  const [ownActive, setOwnActive] = useState(defaultActive ?? null);
  const [ownOpen, setOwnOpen] = useState<string[]>(defaultOpen);
  const active = activeProp === undefined ? ownActive : activeProp;
  const openList = openProp ?? ownOpen;
  const open = useMemo(() => new Set(openList), [openList]);
  const [focus, setFocus] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);
  const [dropOver, setDropOver] = useState<{
    value: string;
    place: DropPlace;
  } | null>(null);
  const dragging = useRef<string | null>(null);
  const springTimer = useRef<{ value: string; id: number } | null>(null);
  const clearSpring = () => {
    if (springTimer.current) window.clearTimeout(springTimer.current.id);
    springTimer.current = null;
  };
  useEffect(() => clearSpring, []);
  const root = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  const setOpen = (next: string[]) => {
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  // The folder being opened right now gets the staggered drop-in.
  const [opening, setOpening] = useState<string | null>(null);
  const openingTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(openingTimer.current), []);
  const toggle = (value: string, force?: boolean) => {
    const isOpen = open.has(value);
    const want = force ?? !isOpen;
    if (want === isOpen) return;
    if (want) {
      setOpening(value);
      window.clearTimeout(openingTimer.current);
      openingTimer.current = window.setTimeout(() => setOpening(null), 1200);
    }
    setOpen(want ? [...openList, value] : openList.filter((v) => v !== value));
  };
  // Flattened visible rows in display order, with parent links for ← navigation.
  const visible = useMemo(() => {
    const rows: { item: BranchedItem; parent: string | null }[] = [];
    const walk = (list: BranchedItem[], parent: string | null) => {
      for (const item of list) {
        rows.push({ item, parent });
        if (item.children?.length && open.has(item.value))
          walk(item.children, item.value);
      }
    };
    walk(items, null);
    return rows;
  }, [items, open]);
  const tabStop =
    visible.find((r) => r.item.value === focus)?.item.value ??
    visible.find((r) => r.item.value === active)?.item.value ??
    visible[0]?.item.value;
  const focusRow = (value: string) => {
    setFocus(value);
    root.current
      ?.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`)
      ?.focus();
  };
  const select = (item: BranchedItem) => {
    if (activeProp === undefined) setOwnActive(item.value);
    onSelect?.(item.value, item);
  };
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const i = visible.findIndex((r) => r.item.value === tabStop);
    const row = visible[i];
    if (!row) return;
    const { item } = row;
    let handled = true;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown"))
      onKeyAction?.(e.key === "ArrowUp" ? "moveUp" : "moveDown", item);
    else if (e.key === "ArrowDown" && visible[i + 1])
      focusRow(visible[i + 1].item.value);
    else if (e.key === "ArrowUp" && visible[i - 1])
      focusRow(visible[i - 1].item.value);
    else if (e.key === "Home") focusRow(visible[0].item.value);
    else if (e.key === "End") focusRow(visible[visible.length - 1].item.value);
    else if (e.key === "ArrowRight" && hasChildren(item)) {
      if (!open.has(item.value)) toggle(item.value, true);
      else if (item.children?.[0]) focusRow(item.children[0].value);
    } else if (e.key === "ArrowLeft") {
      if (hasChildren(item) && open.has(item.value)) toggle(item.value, false);
      else if (row.parent) focusRow(row.parent);
    } else if (e.key === "Enter" || e.key === " ") select(item);
    else if (e.key === "F2") onKeyAction?.("rename", item);
    else if (e.key === "Delete") onKeyAction?.("delete", item);
    else handled = false;
    if (handled) e.preventDefault();
  };
  const fold = reduced ? 0 : foldDuration;
  const draw = reduced ? 0 : drawDuration;
  const vars = {
    "--bm-color": color,
    "--bm-accent": accentColor,
    "--bm-line": lineColor,
    "--bm-row": `${rowHeight}px`,
    "--bm-indent": `${indent}px`,
    "--bm-trunk": `${trunk}px`,
    "--bm-line-w": `${lineWidth}px`,
    "--bm-font": `${fontSize}px`,
    "--bm-draw": `${draw}ms`,
    "--bm-fold": `${fold}ms`,
    width,
  } as CSSProperties;
  const editor = (initial: string) => (
    <EditField
      initial={initial}
      onCommit={(name) => onCommitEdit?.(name)}
      onCancel={() => onCancelEdit?.()}
    />
  );
  const renderList = (list: BranchedItem[], parent: string | null) => {
    const creating = edit?.kind === "create" && edit.parent === parent;
    const total = list.length + (creating ? 1 : 0);
    return (
      <>
        {creating && (
          <li role="none" className="bm-node">
            {parent !== null && (
              <Branch
                last={total === 1}
                radius={radius}
                row={rowHeight}
                reach={indent - trunk}
              />
            )}
            <div className="bm-row bm-editing">{editor("")}</div>
          </li>
        )}
        {list.map((item, index) => {
          const isFolder = hasChildren(item);
          const isOpen = open.has(item.value);
          const last = index + (creating ? 1 : 0) === total - 1;
          const renaming = edit?.kind === "rename" && edit.value === item.value;
          const icon = isOpen && item.openIcon ? item.openIcon : item.icon;
          return (
            <li
              role="treeitem"
              key={item.value}
              style={{ "--i": Math.min(index, 12) } as CSSProperties}
              data-value={item.value}
              tabIndex={item.value === tabStop ? 0 : -1}
              aria-selected={item.value === active}
              aria-expanded={isFolder ? isOpen : undefined}
              aria-label={item.label}
              aria-keyshortcuts={
                item.kind === "folder"
                  ? "F2 Delete Alt+ArrowUp Alt+ArrowDown"
                  : "Delete"
              }
              className={"bm-node" + (last ? " last" : "")}
              onFocus={(e) => {
                if (e.target === e.currentTarget) setFocus(item.value);
              }}
            >
              {parent !== null && (
                <Branch
                  last={last}
                  radius={radius}
                  row={rowHeight}
                  reach={indent - trunk}
                />
              )}
              <div
                className={
                  "bm-row" +
                  (item.value === active ? " active" : "") +
                  (renaming ? " bm-editing" : "") +
                  (dropOver?.value === item.value
                    ? " drop-" + dropOver.place
                    : "")
                }
                draggable={!renaming && !!dragData?.(item)}
                onDragStart={(e) => {
                  const payload = dragData?.(item);
                  if (!payload) return;
                  e.stopPropagation();
                  dragging.current = item.value;
                  e.dataTransfer.setData(payload.type, payload.data);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  const zones = dropZones?.(item, {
                    types: e.dataTransfer.types,
                    source: dragging.current,
                  });
                  if (!zones || (!zones.inside && !zones.between)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  // Edges of a row mean "between rows", the middle "inside".
                  const box = e.currentTarget.getBoundingClientRect();
                  const f = (e.clientY - box.top) / Math.max(1, box.height);
                  const place: DropPlace = !zones.between
                    ? "inside"
                    : !zones.inside
                      ? f < 0.5
                        ? "before"
                        : "after"
                      : f < 0.28
                        ? "before"
                        : f > 0.72
                          ? "after"
                          : "inside";
                  if (
                    dropOver?.value !== item.value ||
                    dropOver.place !== place
                  )
                    setDropOver({ value: item.value, place });
                  // Holding over a closed folder opens it, like a file manager.
                  if (
                    place === "inside" &&
                    isFolder &&
                    !isOpen &&
                    springTimer.current?.value !== item.value
                  ) {
                    clearSpring();
                    springTimer.current = {
                      value: item.value,
                      id: window.setTimeout(
                        () => toggle(item.value, true),
                        650,
                      ),
                    };
                  } else if (place !== "inside") clearSpring();
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  if (dropOver?.value === item.value) setDropOver(null);
                  if (springTimer.current?.value === item.value) clearSpring();
                }}
                onDrop={(e) => {
                  const place = dropOver?.place ?? "inside";
                  setDropOver(null);
                  clearSpring();
                  const type = dragTypes.find((t) =>
                    e.dataTransfer.types.includes(t),
                  );
                  const data = type ? e.dataTransfer.getData(type) : "";
                  if (!type || !data) return;
                  e.preventDefault();
                  onDropData?.(item, place, { type, data });
                }}
                onDragEnd={() => {
                  dragging.current = null;
                  setDropOver(null);
                  clearSpring();
                }}
                onClick={(e) => {
                  if (renaming) return;
                  if ((e.target as HTMLElement).closest(".bm-actions")) return;
                  focusRow(item.value);
                  select(item);
                  if (isFolder && !isOpen) toggle(item.value, true);
                }}
              >
                {isFolder ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    className={"bm-chevron" + (isOpen ? " open" : "")}
                    aria-label={isOpen ? "Collapse" : "Expand"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(item.value);
                    }}
                  >
                    <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
                  </button>
                ) : (
                  <span className="bm-chevron-gap" aria-hidden="true" />
                )}
                {icon && (
                  <HugeiconsIcon
                    icon={icon}
                    size={17}
                    className="bm-icon"
                    aria-hidden="true"
                  />
                )}
                {item.status && (
                  <span
                    className={"bm-dot " + item.status}
                    title={item.status}
                  />
                )}
                {renaming ? (
                  editor(item.label)
                ) : (
                  <span className="bm-label" title={item.label}>
                    {item.label}
                  </span>
                )}
                {!renaming && item.badge !== undefined && (
                  <span className="bm-badge">{item.badge}</span>
                )}
                {!renaming && renderActions && (
                  <span className="bm-actions">{renderActions(item)}</span>
                )}
              </div>
              {isFolder &&
                (item.children?.length ||
                  (edit?.kind === "create" && edit.parent === item.value)) && (
                  <div
                    className={
                      "bm-fold" +
                      (isOpen ? " open" : "") +
                      (opening === item.value ? " opening" : "")
                    }
                  >
                    <ul role="group" className="bm-group" data-open={isOpen}>
                      {renderList(item.children ?? [], item.value)}
                    </ul>
                  </div>
                )}
            </li>
          );
        })}
      </>
    );
  };
  return (
    <ul
      ref={root}
      role="tree"
      aria-label={label}
      className="branched-menu"
      style={vars}
      onKeyDown={onKey}
    >
      {renderList(items, null)}
    </ul>
  );
}

/** One curved connector from the parent's trunk into a child row. */
function Branch({
  last,
  radius,
  row,
  reach,
}: {
  last: boolean;
  radius: number;
  row: number;
  reach: number;
}) {
  const mid = row / 2;
  const r = Math.min(radius, mid);
  // The curve leaves the parent's trunk and ends just before the child's
  // chevron, so it never runs under the icon or label.
  const end = Math.max(1 + r, reach + 8);
  return (
    <>
      {!last && <span className="bm-trunk" aria-hidden="true" />}
      <svg
        className="bm-branch"
        aria-hidden="true"
        width={end + 1}
        height={row}
      >
        <path
          pathLength={1}
          d={`M1 0 V${mid - r} Q1 ${mid} ${1 + r} ${mid} H${end}`}
        />
      </svg>
    </>
  );
}

function EditField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    if (commit && name && name !== initial) onCommit(name);
    else onCancel();
  };
  return (
    <input
      className="bm-input"
      aria-label="Folder name"
      autoFocus
      maxLength={120}
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}
