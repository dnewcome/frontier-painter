// src/hud/transition.ts
// Full-screen fade used between rooms: fade to black, show the next room's
// title card, swap the room while hidden, fade back in. Plain DOM + CSS
// transitions (headed play only — the scripted window.game path never uses it).

export interface Transition {
  /** Fade out, run `swap` while black, then fade in. No-op while one is running. */
  play(kicker: string, title: string, swap: () => void): void;
  busy(): boolean;
}

const FADE_MS = 450;
const HOLD_MS = 1100;

const CSS = `
#room-fade { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px; background: #03060c;
  color: #e8edf2; font-family: ui-monospace, Menlo, monospace; text-align: center;
  opacity: 0; pointer-events: none; transition: opacity ${FADE_MS}ms ease; }
#room-fade.on { opacity: 1; pointer-events: auto; }
#room-fade .k { font-size: 13px; letter-spacing: 0.3em; color: #4fe08a; }
#room-fade .t { font-size: clamp(20px, 4vw, 34px); letter-spacing: 0.08em; font-weight: 700; }
`;

export function createTransition(): Transition {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.id = "room-fade";
  const kick = document.createElement("div");
  kick.className = "k";
  const head = document.createElement("div");
  head.className = "t";
  root.append(kick, head);
  document.body.appendChild(root);

  let running = false;
  return {
    play(kicker, title, swap) {
      if (running) return;
      running = true;
      kick.textContent = kicker;
      head.textContent = title;
      root.classList.add("on");
      window.setTimeout(() => {
        swap();
        window.setTimeout(() => {
          root.classList.remove("on");
          window.setTimeout(() => (running = false), FADE_MS);
        }, HOLD_MS);
      }, FADE_MS);
    },
    busy: () => running,
  };
}
