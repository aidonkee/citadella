import React, { useEffect, useRef } from 'react';

interface Node3D {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  pulsePhase: number;
}

interface Signal {
  fromIdx: number;
  toIdx: number;
  progress: number;
  speed: number;
  color: string;
}

export const NervaNeuralBg: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      mouseRef.current.active = true;
    };
    const handleMouseLeave = () => {
      mouseRef.current.active = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    // Create 3D Nodes
    const nodeCount = Math.min(90, Math.max(45, Math.floor((width * height) / 12000)));
    const nodes: Node3D[] = [];
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        x: (Math.random() - 0.5) * width * 1.2,
        y: (Math.random() - 0.5) * height * 1.2,
        z: (Math.random() - 0.5) * 600,
        vx: (Math.random() - 0.5) * 1.0,
        vy: (Math.random() - 0.5) * 1.0,
        vz: (Math.random() - 0.5) * 0.6,
        radius: Math.random() * 2.5 + 2.0,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }

    const signals: Signal[] = [];
    const colors = ['#8b5cf6', '#a855f7', '#00f0ff', '#ec4899', '#ffffff'];

    // Camera perspective
    const fov = 400;
    let angleX = 0;
    let angleY = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Target camera angle from mouse
      const targetAngleY = mouseRef.current.active
        ? ((mouseRef.current.x - width / 2) / width) * 0.45
        : Math.sin(Date.now() * 0.0004) * 0.2;
      const targetAngleX = mouseRef.current.active
        ? ((mouseRef.current.y - height / 2) / height) * -0.45
        : Math.cos(Date.now() * 0.0003) * 0.2;

      angleY += (targetAngleY - angleY) * 0.05;
      angleX += (targetAngleX - angleX) * 0.05;

      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);
      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);

      // Project nodes
      const projectedNodes = nodes.map((n) => {
        // Rotate around Y
        let rx = n.x * cosY + n.z * sinY;
        let rz = -n.x * sinY + n.z * cosY;
        // Rotate around X
        let ry = n.y * cosX - rz * sinX;
        rz = n.y * sinX + rz * cosX;

        // Perspective projection
        const scale = fov / (fov + rz + 400);
        const px = width / 2 + rx * scale;
        const py = height / 2 + ry * scale;

        return { ...n, rx, ry, rz, scale, px, py };
      });

      // Update node positions
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;
        n.z += n.vz;

        if (Math.abs(n.x) > width * 0.7) n.vx *= -1;
        if (Math.abs(n.y) > height * 0.7) n.vy *= -1;
        if (Math.abs(n.z) > 400) n.vz *= -1;

        n.pulsePhase += 0.03;
      }

      // Draw connections
      const maxDist = 210;
      for (let i = 0; i < projectedNodes.length; i++) {
        const p1 = projectedNodes[i];
        for (let j = i + 1; j < projectedNodes.length; j++) {
          const p2 = projectedNodes[j];
          const dx = p1.rx - p2.rx;
          const dy = p1.ry - p2.ry;
          const dz = p1.rz - p2.rz;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * Math.min(p1.scale, p2.scale) * 0.65;
            ctx.beginPath();
            ctx.moveTo(p1.px, p1.py);
            ctx.lineTo(p2.px, p2.py);
            ctx.strokeStyle = `rgba(168, 85, 247, ${alpha})`;
            ctx.lineWidth = 1.3 * ((p1.scale + p2.scale) / 2);
            ctx.stroke();

            // Randomly spawn signals
            if (Math.random() < 0.0025 && signals.length < 35) {
              signals.push({
                fromIdx: i,
                toIdx: j,
                progress: 0,
                speed: 0.015 + Math.random() * 0.025,
                color: colors[Math.floor(Math.random() * colors.length)],
              });
            }
          }
        }
      }

      // Draw and update signals
      for (let i = signals.length - 1; i >= 0; i--) {
        const s = signals[i];
        const p1 = projectedNodes[s.fromIdx];
        const p2 = projectedNodes[s.toIdx];
        if (!p1 || !p2) {
          signals.splice(i, 1);
          continue;
        }

        s.progress += s.speed;
        if (s.progress >= 1) {
          signals.splice(i, 1);
          continue;
        }

        const sx = p1.px + (p2.px - p1.px) * s.progress;
        const sy = p1.py + (p2.py - p1.py) * s.progress;
        const sScale = (p1.scale + p2.scale) / 2;

        ctx.beginPath();
        ctx.arc(sx, sy, 3.0 * sScale, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Draw nodes
      for (let i = 0; i < projectedNodes.length; i++) {
        const p = projectedNodes[i];
        const pulse = Math.sin(p.pulsePhase) * 0.35 + 1;
        const size = p.radius * p.scale * pulse;

        ctx.beginPath();
        ctx.arc(p.px, p.py, Math.max(1.2, size), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(236, 72, 153, ${Math.min(1, p.scale * 0.95)})`;
        ctx.shadowColor = '#a855f7';
        ctx.shadowBlur = size * 4;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Inner white core
        ctx.beginPath();
        ctx.arc(p.px, p.py, Math.max(0.6, size * 0.45), 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-95" />
      
      {/* Cyber Sharp Geometric Corner Accents */}
      <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-primary/40 pointer-events-none" />
      <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-primary/40 pointer-events-none" />
      <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-primary/40 pointer-events-none" />
      <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-primary/40 pointer-events-none" />
      <div className="absolute top-1/2 left-4 -translate-y-1/2 text-[10px] font-mono text-primary/30 tracking-widest pointer-events-none rotate-[-90deg]">
        NERVA//SYS:ONLINE
      </div>
      <div className="absolute top-1/2 right-4 -translate-y-1/2 text-[10px] font-mono text-primary/30 tracking-widest pointer-events-none rotate-[90deg]">
        NEURAL//LINK:ACTIVE
      </div>
    </div>
  );
};
