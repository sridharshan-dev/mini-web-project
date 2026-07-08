const fs = require("fs");
const newCss = `
/* ── DYNAMIC BACKGROUND ── */
#dynamic-bg {
  position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden;
  background: var(--bg);
}

.ambient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.5;
  animation: floatOrb 20s infinite ease-in-out alternate;
}
.orb-1 { width: 60vw; height: 60vw; background: var(--gold-dark); top: -20%; left: -20%; animation-duration: 25s; opacity: 0.15; }
.orb-2 { width: 50vw; height: 50vw; background: var(--gold); bottom: -20%; right: -20%; animation-duration: 22s; animation-delay: -5s; opacity: 0.12; }
.orb-3 { width: 40vw; height: 40vw; background: #ffffff; top: 30%; left: 50%; animation-duration: 18s; animation-delay: -10s; opacity: 0.05; }

@keyframes floatOrb {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(8vw, 12vh) scale(1.1); }
  100% { transform: translate(-8vw, -8vh) scale(0.9); }
}

.particles {
  position: absolute; inset: 0;
  opacity: 0.6;
}
.p1 {
  background-image:
    radial-gradient(1.5px 1.5px at 10% 15%, var(--gold-light) 0%, transparent 100%),
    radial-gradient(1px 1px at 25% 40%, #ffffff 0%, transparent 100%),
    radial-gradient(2px 2px at 50% 10%, var(--gold) 0%, transparent 100%),
    radial-gradient(1px 1px at 70% 60%, var(--gold-light) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 90% 30%, #ffffff 0%, transparent 100%),
    radial-gradient(1px 1px at 15% 70%, var(--gold) 0%, transparent 100%),
    radial-gradient(2px 2px at 35% 85%, var(--gold-light) 0%, transparent 100%),
    radial-gradient(1px 1px at 60% 45%, #ffffff 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 80% 15%, var(--gold) 0%, transparent 100%),
    radial-gradient(1px 1px at 45% 65%, var(--gold-light) 0%, transparent 100%);
  background-size: 150px 150px;
  animation: driftUp1 40s linear infinite;
}
.p2 {
  background-image:
    radial-gradient(1px 1px at 5% 50%, var(--gold) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 95% 50%, var(--gold-light) 0%, transparent 100%),
    radial-gradient(2px 2px at 30% 25%, #ffffff 0%, transparent 100%),
    radial-gradient(1px 1px at 65% 75%, var(--gold) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 85% 90%, var(--gold-light) 0%, transparent 100%);
  background-size: 200px 200px;
  animation: driftUp2 60s linear infinite;
  opacity: 0.4;
}

@keyframes driftUp1 {
  from { background-position: 0 0; }
  to { background-position: 0 -150px; }
}
@keyframes driftUp2 {
  from { background-position: 0 0; }
  to { background-position: 0 -200px; }
}
`;
fs.appendFileSync("frontend/css/style.css", newCss, "utf8");
fs.appendFileSync("frontend/css/admin.css", newCss, "utf8");
console.log("CSS injected!");
