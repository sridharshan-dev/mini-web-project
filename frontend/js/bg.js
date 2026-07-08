const canvas = document.createElement('canvas');
canvas.id = 'interactive-bg';
canvas.style.position = 'fixed';
canvas.style.inset = '0';
canvas.style.zIndex = '0';
canvas.style.pointerEvents = 'none';
canvas.style.animation = 'fadeIn 1.5s ease-in-out';
document.body.insertBefore(canvas, document.body.firstChild);

const ctx = canvas.getContext('2d');
let width, height;
let particles = [];
let shockwaves = [];
const mouse = { x: -1000, y: -1000, radius: 150 };

function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}

window.addEventListener('resize', resize);
resize();

window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
window.addEventListener('mouseout', () => {
  mouse.x = -1000;
  mouse.y = -1000;
});

class Particle {
  constructor() {
    this.x = Math.random() * width;
    this.y = Math.random() * height;
    this.baseVx = (Math.random() - 0.5) * 0.5;
    this.baseVy = (Math.random() - 0.5) * 0.5;
    this.vx = this.baseVx;
    this.vy = this.baseVy;
    this.baseRadius = Math.random() * 2.5 + 1.2;
    this.radius = this.baseRadius;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;

    // Smoothly damp velocity back towards the normal, slow base velocity
    this.vx += (this.baseVx - this.vx) * 0.02;
    this.vy += (this.baseVy - this.vy) * 0.02;

    // Bounce off edges (invert base velocities too)
    if (this.x < 0 || this.x > width) {
      this.vx = -this.vx;
      this.baseVx = -this.baseVx;
    }
    if (this.y < 0 || this.y > height) {
      this.vy = -this.vy;
      this.baseVy = -this.baseVy;
    }

    // Interactive mouse repulsion / glow
    const dx = mouse.x - this.x;
    const dy = mouse.y - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < mouse.radius) {
      this.radius = this.baseRadius + (mouse.radius - distance) * 0.02;
    } else {
      this.radius = this.baseRadius;
    }
  }

  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    
    // Add subtle shadow glow
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(212, 175, 55, 0.4)';
    
    const dx = mouse.x - this.x;
    const dy = mouse.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < mouse.radius) {
      const intensity = 1 - dist / mouse.radius;
      // Blend from Gold to White
      const r = Math.round(212 + (255 - 212) * intensity);
      const g = Math.round(175 + (255 - 175) * intensity);
      const b = Math.round(55 + (255 - 55) * intensity);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.max(0.4, intensity)})`;
      ctx.shadowBlur = 15 + (10 * intensity);
    } else {
      // Base muted gold particles
      ctx.fillStyle = 'rgba(212, 175, 55, 0.3)';
    }

    ctx.fill();
    
    // Reset shadow
    ctx.shadowBlur = 0;
  }
}

function init() {
  particles = [];
  const particleCount = (width * height) / 15000; // less dense
  for (let i = 0; i < particleCount; i++) {
    particles.push(new Particle());
  }
}

function animate() {
  // Charcoal / Space-black background
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, width, height);

  // Draw subtle ambient glow at mouse
  if (mouse.x !== -1000) {
    const gradient = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, mouse.radius * 2);
    gradient.addColorStop(0, 'rgba(212, 175, 55, 0.15)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  for (let i = 0; i < particles.length; i++) {
    particles[i].update();
    particles[i].draw();

    // Connect nearby particles
    for (let j = i; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Calculate distance from connection to mouse
      const midX = (particles[i].x + particles[j].x) / 2;
      const midY = (particles[i].y + particles[j].y) / 2;
      const mouseDist = Math.sqrt(Math.pow(mouse.x - midX, 2) + Math.pow(mouse.y - midY, 2));

      // Only draw lines if they are close to the mouse AND close to each other
      if (dist < 130 && mouseDist < mouse.radius) {
        ctx.beginPath();
        // Calculate intensity based on mouse proximity
        const intensity = 1 - mouseDist / mouse.radius;
        const lineAlpha = Math.min(1.0, 1.8 * intensity * (1 - dist / 130));

        // Blend line from Gold to White for extra radiance
        const r = Math.round(212 + (255 - 212) * intensity);
        const g = Math.round(175 + (255 - 175) * intensity);
        const b = Math.round(55 + (255 - 55) * intensity);

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${lineAlpha})`;
        ctx.lineWidth = 1.2 + (intensity * 1.8);
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.stroke();
      }
    }
  }

  // Call the external physics logic to detect and pop polygons
  if (typeof detectAndPopPolygons === 'function') {
    detectAndPopPolygons(particles, shockwaves, mouse);
  }

  // Update and draw shockwaves
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const sw = shockwaves[i];
    sw.update();
    sw.draw(ctx);
    if (sw.alpha <= 0) {
      shockwaves.splice(i, 1);
    }
  }

  requestAnimationFrame(animate);
}

init();
animate();
