class Shockwave {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 1;
    this.alpha = 1.0;
  }
  
  update() {
    this.radius += 6; // Slower expansion for smooth ripples
    this.alpha -= 0.015; // Smooth fade out
  }
  
  draw(ctx) {
    if (this.alpha <= 0) return;
    
    const numRipples = 3;
    for (let i = 0; i < numRipples; i++) {
      const r = this.radius - (i * 20);
      if (r <= 0) continue;
      
      const rippleAlpha = this.alpha * (1 - i * 0.3);
      if (rippleAlpha <= 0) continue;
      
      // Color for the wave (Gold as it expands and fades)
      const red = 212;
      const green = 175;
      const blue = 55;

      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${rippleAlpha})`;
      
      // Thicker lines for the primary ripple, thinner for trailing waves
      ctx.lineWidth = Math.max(0.5, (3 - i) * rippleAlpha * 2.5);
      ctx.stroke();
    }
  }
}

let lastPopTime = 0;

function detectAndPopPolygons(particles, shockwaves, mouse) {
  // Prevent explosions from overlapping every single frame
  if (Date.now() - lastPopTime < 1200) return;

  // 1. Build adjacency list for particles near the mouse
  const adj = new Map();
  const nearParticles = [];
  
  for (let i = 0; i < particles.length; i++) {
    const dx = mouse.x - particles[i].x;
    const dy = mouse.y - particles[i].y;
    if (Math.sqrt(dx*dx + dy*dy) > mouse.radius * 1.5) continue;
    nearParticles.push(i);
    adj.set(i, []);
  }
  
  // 2. Connect close particles (same distance logic as the visual lines)
  for (let i = 0; i < nearParticles.length; i++) {
    for (let j = i + 1; j < nearParticles.length; j++) {
      const pi = nearParticles[i];
      const pj = nearParticles[j];
      const p1 = particles[pi];
      const p2 = particles[pj];
      const dist = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
      
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const mouseDist = Math.sqrt(Math.pow(mouse.x - midX, 2) + Math.pow(mouse.y - midY, 2));
      
      if (dist < 130 && mouseDist < mouse.radius) {
        adj.get(pi).push(pj);
        adj.get(pj).push(pi);
      }
    }
  }

  // 3. DFS to find cycles of length >= 4
  let visited = new Set();
  let path = [];
  let foundCycle = null;
  
  function dfs(node, parent) {
    if (foundCycle) return;
    visited.add(node);
    path.push(node);
    
    const neighbors = adj.get(node) || [];
    for (let n of neighbors) {
      if (n === parent) continue;
      
      if (visited.has(n)) {
        // Back-edge found! We have a cycle.
        const cycleStartIndex = path.indexOf(n);
        if (cycleStartIndex !== -1) {
          const cycle = path.slice(cycleStartIndex);
          if (cycle.length >= 4) {
            foundCycle = cycle;
            return;
          }
        }
      } else {
        dfs(n, node);
        if (foundCycle) return;
      }
    }
    path.pop();
  }
  
  for (let node of nearParticles) {
    if (!visited.has(node) && !foundCycle) {
      dfs(node, -1);
    }
  }
  
  // 4. Trigger explosion if a polygon was found
  if (foundCycle) {
    lastPopTime = Date.now();
    
    // Calculate geometric center of the polygon
    let cx = 0, cy = 0;
    for (let idx of foundCycle) {
      cx += particles[idx].x;
      cy += particles[idx].y;
    }
    cx /= foundCycle.length;
    cy /= foundCycle.length;
    
    // Spawn shockwave
    shockwaves.push(new Shockwave(cx, cy));
    
    // Push particles away (Explosion!)
    for (let idx of foundCycle) {
      const p = particles[idx];
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy) || 1;
      
      // Explosion velocity vector - gentler push
      const force = 8; 
      p.vx = (dx / dist) * force + (Math.random() - 0.5) * 2;
      p.vy = (dy / dist) * force + (Math.random() - 0.5) * 2;
    }
    
    // Push away ANY other particles near the explosion center slightly
    for (let p of particles) {
      if (foundCycle.includes(particles.indexOf(p))) continue;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 200) {
        const force = 150 / (dist + 10);
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
      }
    }
  }
}
