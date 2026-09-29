// src/hud/title.ts
// The title (splash) screen shown on every launch, over the live room: the
// FRONTIER PAINTER wordmark, a tagline, Continue / Start, New game, and the
// music toggle. Its button tap is also the user gesture iOS requires before
// any audio can play, so it unlocks audio on the way out.

export interface TitleDeps {
  /** "Room 3 · Mag Boots" when resuming past room 1, else null (fresh start). */
  resumeLabel: string | null;
  /** Start over from the first tutorial room. */
  newGame: () => void;
  musicOn: () => boolean;
  setMusic: (on: boolean) => void;
  /** Called inside the tap that dismisses the screen (unlock audio here). */
  onStart: () => void;
}

const CSS = `
#title { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 14px; padding: 24px;
  background: radial-gradient(ellipse at 50% 40%, rgba(8,16,32,0.55), rgba(3,6,12,0.92) 70%);
  color: #e8f2ff; font-family: system-ui, -apple-system, sans-serif; text-align: center;
  transition: opacity 0.5s ease; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
#title.gone { opacity: 0; pointer-events: none; }
body.on-title :is(#hud, #hud-obj, #touch-ui, #exit-cue, #paint-mark, #pointer-hint, #crosshair) { visibility: hidden; }
#title .mark { font: 800 clamp(34px, 8vw, 78px)/0.95 ui-monospace, Menlo, monospace; letter-spacing: 0.14em;
  text-shadow: 0 0 30px rgba(140,217,255,0.35); }
#title .mark span { display: block; font-size: 0.62em; letter-spacing: 0.34em; margin-top: 0.12em;
  background: linear-gradient(90deg, #8cd9ff, #ffa829 55%, #b86bff); -webkit-background-clip: text;
  background-clip: text; color: transparent; }
#title svg.stroke { width: min(520px, 80vw); height: 26px; margin-top: -4px; }
#title .tag { font-size: clamp(13px, 2.2vw, 17px); opacity: 0.8; max-width: 34em; line-height: 1.4; }
#title .btns { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; min-width: min(320px, 80vw); }
#title button { border: 0; border-radius: 14px; padding: 14px 20px; font: 700 16px/1.1 system-ui, -apple-system, sans-serif;
  color: #e8f2ff; background: rgba(140,217,255,0.14); box-shadow: inset 0 0 0 2px rgba(140,217,255,0.45); }
#title button.go { background: rgba(79,224,138,0.22); box-shadow: inset 0 0 0 2px #4fe08a, 0 0 22px rgba(79,224,138,0.35);
  font-size: 18px; padding: 16px 22px; }
#title button small { display: block; font-weight: 500; font-size: 12px; opacity: 0.75; margin-top: 4px; }
#title .row { display: flex; gap: 10px; }
#title .row button { flex: 1; }
#title .foot { position: absolute; bottom: max(10px, env(safe-area-inset-bottom)); font-size: 11px; opacity: 0.45; }
@media (max-height: 430px) { #title { gap: 8px; } #title .btns { flex-direction: row; flex-wrap: wrap; justify-content: center; }
  #title .btns > * { flex: 1 1 200px; } }
`;

export function showTitle(deps: TitleDeps): void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "title";
  root.innerHTML = `
    <div class="mark">FRONTIER<span>PAINTER</span></div>
    <svg class="stroke" viewBox="0 0 520 26" aria-hidden="true">
      <defs><linearGradient id="tg" x1="0" x2="1">
        <stop offset="0" stop-color="#8cd9ff"/><stop offset="0.55" stop-color="#ffa829"/><stop offset="1" stop-color="#b86bff"/>
      </linearGradient></defs>
      <path d="M10 16 C 120 4, 240 24, 360 12 S 500 8, 510 14" fill="none" stroke="url(#tg)" stroke-width="7" stroke-linecap="round"/>
    </svg>
    <div class="tag">You woke early. The ship's reality is breaking apart — and a painter's palette of physics is all you have to fix it.</div>
    <div class="btns"></div>
    <div class="foot">© 2026 Dan Newcome</div>`;
  document.body.appendChild(root);
  document.body.classList.add("on-title");
  const btns = root.querySelector(".btns") as HTMLDivElement;

  const go = document.createElement("button");
  go.className = "go";
  go.innerHTML = deps.resumeLabel ? `Continue<small>${deps.resumeLabel}</small>` : "Start";
  btns.appendChild(go);

  const row = document.createElement("div");
  row.className = "row";
  btns.appendChild(row);
  if (deps.resumeLabel) {
    const fresh = document.createElement("button");
    fresh.className = "new";
    fresh.textContent = "New game";
    row.appendChild(fresh);
    fresh.addEventListener("click", () => {
      deps.newGame();
      dismiss();
    });
  }
  const music = document.createElement("button");
  music.className = "music";
  const label = (): void => {
    music.textContent = `♪ Music: ${deps.musicOn() ? "On" : "Off"}`;
  };
  label();
  row.appendChild(music);
  music.addEventListener("click", () => {
    deps.setMusic(!deps.musicOn());
    label();
  });

  const dismiss = (): void => {
    deps.onStart();
    root.classList.add("gone");
    document.body.classList.remove("on-title");
    window.setTimeout(() => root.remove(), 600);
  };
  go.addEventListener("click", dismiss);
}
