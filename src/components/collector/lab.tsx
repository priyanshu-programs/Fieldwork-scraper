"use client";
import { useState, useEffect } from "react";
import Collector from "./collector";
import { states, captions, type CollectorState } from "./model";
export default function Lab() {
  const [state, setState] = useState<CollectorState>("idle"),
    [reduced, setReduced] = useState(false),
    [paused, setPaused] = useState(false),
    [restart, setRestart] = useState(0),
    [count, setCount] = useState(3),
    [offline, setOffline] = useState(false),
    [rapid, setRapid] = useState(false);
  useEffect(() => {
    if (!rapid) return;
    let i = 0;
    const timer = setInterval(() => {
      setState(states[2 + (i++ % 9)]);
      if (i === 9) setRapid(false);
    }, 120);
    return () => clearInterval(timer);
  }, [rapid]);
  return (
    <main className="collector-lab">
      <h1>Collector motion lab</h1>
      <p>Development artwork preview · no research records</p>
      <div className="collector-lab-controls">
        <label>
          State{" "}
          <select
            aria-label="State"
            value={state}
            onChange={(e) => setState(e.target.value as CollectorState)}
          >
            {states.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={reduced}
            onChange={(e) => setReduced(e.target.checked)}
          />{" "}
          Reduced motion
        </label>
        <label>
          <input
            type="checkbox"
            checked={paused}
            onChange={(e) => setPaused(e.target.checked)}
          />{" "}
          Pause
        </label>
        <label>
          <input
            type="checkbox"
            checked={offline}
            onChange={(e) => setOffline(e.target.checked)}
          />{" "}
          Disconnect
        </label>
        <label>
          Saved pages{" "}
          <input
            type="number"
            min="0"
            max="25"
            value={count}
            onChange={(e) =>
              setCount(Math.max(0, Math.min(25, +e.target.value)))
            }
          />
        </label>
        <button onClick={() => setRestart((n) => n + 1)}>Restart action</button>
        <button onClick={() => setRapid(true)}>Rapid events</button>
        <button onClick={() => setState("fetching")}>Slow request</button>
      </div>
      <Collector
        state={offline ? "offline" : state}
        completed={count}
        failed={state === "partial" ? 2 : 0}
        crawl
        reduced={reduced}
        paused={paused}
        restart={restart}
      />
      <p role="status">{captions[offline ? "offline" : state]}</p>
      <p>Compare compact silhouettes</p>
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ width: 64 }}>
          <Collector state={state} reduced compact />
        </div>
        <div style={{ width: 180 }}>
          <Collector state={state} reduced compact />
        </div>
      </div>
    </main>
  );
}
