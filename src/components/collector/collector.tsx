"use client";
import { useEffect, useRef, useId } from "react";
import { motion, wave, seg, travel, arrive } from "./motion";
import type { CollectorState } from "./model";
type Props = {
  state: CollectorState;
  compact?: boolean;
  completed?: number;
  failed?: number;
  crawl?: boolean;
  reduced?: boolean;
  paused?: boolean;
  restart?: number;
};
// Coordinates are instrument units. All moving transforms use explicit joint pivots.
export default function Collector({
  state,
  compact = false,
  completed = 0,
  failed = 0,
  crawl = false,
  reduced = false,
  paused = false,
  restart = 0,
}: Props) {
  const svg = useRef<SVGSVGElement>(null),
    values = useRef<Record<string, number>>({
      body: 0,
      turn: 0,
      probe: 0,
      tip: 0,
      leg: 0,
      outer: 0,
      cardX: -145,
      cardY: 0,
      route: 0,
      card: 0,
      clean: 0,
      ticks: 0,
      stamp: 0,
    }),
    id = useId().replace(/:/g, "");
  useEffect(() => {
    const root = svg.current!;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const parts = new Map(
      Array.from(root.querySelectorAll<SVGElement>("[data-part]")).map((e) => [
        e.dataset.part!,
        e,
      ]),
    );
    let raf = 0,
      visible = false,
      last = 0,
      time = 0,
      elapsed = 0;
    const set = (name: string, attribute: string, value: string) =>
      parts.get(name)?.setAttribute(attribute, value);
    const draw = (dt: number, still: boolean) => {
      time += dt;
      elapsed += dt;
      const t = still ? motion.duration : elapsed;
      const wait = state === "fetching" || state === "retrying";
      const active = !["offline", "idle", "partial", "failed"].includes(state);
      const settled =
        state === "offline" || state === "failed" || state === "partial";
      const p = arrive(seg(t, 0, 1000));
      const targets: Record<string, number> = {
        body: state === "offline" ? 14 : state === "saving" ? -3 : 0,
        turn: state === "preparing" ? -4 : state === "runComplete" ? 3 : 0,
        probe:
          state === "offline"
            ? 22
            : state === "preparing"
              ? -10
              : !still && !settled
                ? motion.probe * Math.pow(Math.max(0, wave(time, 5200)), 8)
                : 0,
        tip:
          state === "offline"
            ? 18
            : !still && !settled
              ? 5 * Math.pow(Math.max(0, wave(time - motion.follow, 5200)), 8)
              : 0,
        leg: !still && wait ? motion.step * wave(time, 1600) : 0,
        outer: !still && wait ? 2 * wave(time - motion.follow, 1600) : 0,
        cardX:
          state === "preparing"
            ? -145 * (1 - p)
            : state === "retrying"
              ? 94 * (1 - p)
              : state === "cleaning"
                ? 30 * travel(seg(t, 0, 1300))
                : state === "saving" || state === "runComplete"
                  ? 94 * travel(seg(t, 0, 1200))
                  : state === "failed"
                    ? 94 * travel(seg(t, 0, 900))
                    : 0,
        cardY: state === "failed" ? 42 * p : 0,
        route:
          state === "failed" || state === "offline"
            ? 0
            : wait
              ? 0.75 + 0.08 * (!still ? wave(time, 4000) : 0)
              : active
                ? 1
                : 0,
        card: active || state === "failed" ? 1 : 0,
        clean: ["cleaning", "saving", "pageComplete", "runComplete"].includes(
          state,
        )
          ? 1
          : 0,
        ticks: state === "preparing" ? 1 - Math.min(1, seg(t, 700, 1100)) : 0,
        stamp:
          state === "runComplete"
            ? 3 * Math.sin(Math.PI * seg(t, 900, 1500))
            : 0,
      };
      // Continuous-value interpolation survives effect restarts and fast events.
      const k = still ? 1 : 1 - Math.exp(-dt / 95);
      for (const key in targets)
        values.current[key] =
          (values.current[key] ?? targets[key]) +
          (targets[key] - (values.current[key] ?? targets[key])) * k;
      const v = values.current;
      set(
        "collector",
        "transform",
        `translate(0 ${v.body}) rotate(${v.turn} 150 119)`,
      );
      set("shadow", "transform", `translate(0 ${v.body * 0.25})`);
      for (const side of ["left", "right"]) {
        const sign = side === "left" ? 1 : -1,
          x = side === "left" ? 133 : 167;
        set(
          `antenna-${side}-base`,
          "transform",
          `rotate(${sign * v.probe} ${x} 84)`,
        );
        set(
          `antenna-${side}-tip`,
          "transform",
          `rotate(${sign * v.tip} ${x + sign * -13} 65)`,
        );
        for (const [i, leg] of [
          "rear-legs",
          "middle-legs",
          "front-leg",
        ].entries()) {
          set(
            `${leg}-${side}`,
            "transform",
            `rotate(${sign * v.leg * (i % 2 ? -1 : 1)} ${x} ${134 - i * 17})`,
          );
          set(
            `${leg}-${side}-outer`,
            "transform",
            `rotate(${sign * v.outer} ${side === "left" ? 113 : 187} ${143 - i * 22})`,
          );
        }
      }
      set("source-card", "transform", `translate(${v.cardX} ${v.cardY})`);
      set("source-card", "opacity", String(v.card));
      set("clean-card", "opacity", String(v.clean));
      set("route-line", "stroke-dashoffset", String(130 * (1 - v.route)));
      set("measurement-ticks", "opacity", String(v.ticks));
      set("fieldwork-marks", "transform", `translate(0 ${v.stamp})`);
      set(
        "connection-line",
        "stroke-dasharray",
        state === "offline" ? "12 10" : "40 0",
      );
      root.dataset.time = String(Math.round(elapsed));
    };
    function tick(now: number) {
      const dt = last ? Math.min(40, now - last) : 16;
      last = now;
      draw(dt, false);
      if (
        [
          "offline",
          "failed",
          "partial",
          "pageComplete",
          "runComplete",
          "preparing",
          "cleaning",
          "saving",
        ].includes(state) &&
        elapsed > 2100
      ) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      if (reduced || media.matches) {
        draw(0, true);
        return;
      }
      if (visible && !document.hidden && !paused)
        raf = requestAnimationFrame(tick);
    }
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      sync();
    });
    observer.observe(root);
    document.addEventListener("visibilitychange", sync);
    media.addEventListener("change", sync);
    sync();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      media.removeEventListener("change", sync);
    };
  }, [state, reduced, paused, restart]);
  const part = (name: string) => ({ "data-part": name, id: `${id}-${name}` });
  const lamp =
    state === "offline"
      ? "var(--color-rule)"
      : state === "failed"
        ? "var(--color-error)"
        : ["pageComplete", "runComplete", "idle"].includes(state)
          ? "var(--color-success)"
          : "var(--color-accent)";
  return (
    <svg
      ref={svg}
      className="collector-art"
      viewBox={compact ? "98 43 104 128" : "0 0 300 220"}
      data-compact={compact}
      aria-hidden="true"
      data-state={state}
    >
      <g fill="none" stroke="var(--color-rule)" strokeWidth="1">
        <path {...part("worker-dock")} d="M110 160v23h80v-23M117 178h66" />
        <path
          {...part("connection-line")}
          d="M150 183v27"
          stroke="var(--color-accent)"
        />
        <g {...part("crawl-boundary")} opacity={crawl ? 1 : 0}>
          <rect
            x="17"
            y="32"
            width="266"
            height="155"
            rx="5"
            strokeDasharray="3 5"
          />
          <path d="M34 32v8m10-8v8m10-8v8" />
        </g>
        <path
          {...part("route-line")}
          d="M26 107H70Q95 107 103 94"
          pathLength="130"
          strokeDasharray="130"
          stroke="var(--color-accent)"
        />
        <g {...part("route-node")}>
          <circle cx="26" cy="107" r="3" />
          <circle cx="64" cy="107" r="2" />
        </g>
        <g {...part("archive-slot")}>
          <rect x="229" y="67" width="51" height="67" rx="4" />
          <path d="M235 82h39M235 89h39M235 96h39" />
        </g>
        {Array.from({ length: Math.min(25, completed) }, (_, i) => (
          <path
            key={i}
            d={`M${235 + (i % 5) * 7} ${105 + Math.floor(i / 5) * 4}h5`}
            stroke="var(--color-success)"
          />
        ))}
        <g {...part("failure-tray")}>
          <path d="M232 155v20h47v-20" />
          {Array.from({ length: Math.min(25, failed) }, (_, i) => (
            <path
              key={i}
              d={`M${237 + (i % 5) * 7} ${160 + Math.floor(i / 5) * 2}v10`}
              stroke="var(--color-error)"
            />
          ))}
        </g>
        <g {...part("date-label")}>
          <rect x="234" y="137" width="41" height="10" rx="1" />
          <path d="M239 142h7m4 0h4m4 0h11" />
        </g>
      </g>
      <ellipse
        {...part("shadow")}
        cx="150"
        cy="139"
        rx="46"
        ry="28"
        fill="var(--color-paper)"
      />
      <g {...part("source-card")} opacity="0">
        <rect
          x="81"
          y="93"
          width="48"
          height="34"
          rx="2"
          fill="var(--color-paper-2)"
          stroke="var(--color-accent)"
        />
        <path
          d="M87 101h24m-24 6h32m-32 6h17m-17 6h28"
          stroke="var(--color-muted)"
          strokeWidth="2"
        />
        <g {...part("source-label")}>
          <path d="M81 88h29v7H81z" fill="var(--color-accent)" />
        </g>
        <g {...part("clean-card")} opacity="0">
          <rect
            x="81"
            y="93"
            width="48"
            height="34"
            rx="2"
            fill="var(--color-ink)"
          />
          <path
            {...part("markdown-lines")}
            d="M87 101h29m-29 6h29m-29 6h29m-29 6h21"
            stroke="var(--color-paper)"
            strokeWidth="1.5"
          />
        </g>
      </g>
      <g {...part("collector")}>
        <g
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {["left", "right"].map((side) => {
            const left = side === "left",
              x = left ? 133 : 167,
              a = left ? 113 : 187,
              b = left ? 104 : 196;
            return (
              <g key={side}>
                {["rear-legs", "middle-legs", "front-leg"].map((name, i) => (
                  <g key={name} {...part(`${name}-${side}`)}>
                    <path d={`M${x} ${134 - i * 17}L${a} ${143 - i * 22}`} />
                    <g {...part(`${name}-${side}-outer`)}>
                      <path d={`M${a} ${143 - i * 22}L${b} ${156 - i * 28}`} />
                    </g>
                  </g>
                ))}
              </g>
            );
          })}
        </g>
        <g {...part("body-base")}>
          <path
            d="M150 80C106 80 110 151 150 158C190 151 194 80 150 80Z"
            fill="var(--color-paper-3)"
            stroke="var(--color-accent)"
            strokeWidth="1.5"
          />
        </g>
        <g {...part("card-slot")}>
          <path d="M117 113h66v9h-66z" fill="var(--color-paper)" />
          <path d="M120 114h60" stroke="var(--color-muted)" />
        </g>
        <g {...part("shell-left")}>
          <path
            d="M149 88C122 86 117 106 121 129Q126 148 150 153V88Z"
            fill="var(--color-accent)"
          />
        </g>
        <g {...part("shell-right")}>
          <path
            d="M150 88C177 86 183 106 179 129Q174 148 149 153V88Z"
            fill="var(--color-muted)"
          />
        </g>
        <path d="M150 92v55" stroke="var(--color-paper)" strokeWidth="1.5" />
        <g
          {...part("fieldwork-marks")}
          stroke="var(--color-paper)"
          strokeWidth="3"
        >
          <path d="M133 123l8-16m1 20l8-16m1 20l8-16" />
        </g>
        <g {...part("head")}>
          <path
            d="M132 92V81Q150 69 168 81V92Z"
            fill="var(--color-ink)"
            stroke="var(--color-paper)"
            strokeWidth="2"
          />
        </g>
        <g
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          {["left", "right"].map((side) => {
            const x = side === "left" ? 133 : 167,
              dx = side === "left" ? -13 : 13;
            return (
              <g key={side} {...part(`antenna-${side}-base`)}>
                <path d={`M${x} 84L${x + dx} 65`} />
                <circle cx={x + dx} cy="65" r="2" fill="var(--color-paper)" />
                <g {...part(`antenna-${side}-tip`)}>
                  <path d={`M${x + dx} 65L${x + dx * 1.3} 50`} />
                  <circle
                    cx={x + dx * 1.3}
                    cy="50"
                    r="2"
                    fill="var(--color-ink)"
                  />
                </g>
              </g>
            );
          })}
        </g>
        <circle
          {...part("status-lamp")}
          cx="150"
          cy="83"
          r="3.5"
          fill={lamp}
          style={{ transition: "fill 300ms" }}
        />
        <g
          {...part("card-clamp")}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="2"
        >
          <path d="M138 76v-8h6m18 8v-8h-6" />
        </g>
      </g>
      <g
        {...part("measurement-ticks")}
        opacity="0"
        stroke="var(--color-accent)"
      >
        <path d="M77 89v-7h7m-7 48v7h7m-10-37h5m-5 10h5" />
      </g>
    </svg>
  );
}
