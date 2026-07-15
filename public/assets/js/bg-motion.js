/**
 * ABSU Election Portal 2026 - Background Motion Effect
 * Highly premium, optimized, theme-sensitive, and responsive.
 */

(function () {
    // Accessibility check: respects user preference for reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
        console.log('ABSU BG Motion: Reduced motion preferred. Background animations disabled.');
        return;
    }

    // Create container and inject elements
    const container = document.createElement('div');
    container.id = 'bg-motion-container';
    Object.assign(container.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '-9999',
        pointerEvents: 'none',
        overflow: 'hidden',
    });

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.id = 'bg-motion-canvas';
    Object.assign(canvas.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
    });
    container.appendChild(canvas);

    // Create 2 ambient gradient blobs
    const blob1 = document.createElement('div');
    const blob2 = document.createElement('div');

    Object.assign(blob1.style, {
        position: 'absolute',
        width: '45vw',
        height: '45vw',
        borderRadius: '50%',
        filter: 'blur(120px)',
        top: '-10%',
        left: '-10%',
        transition: 'background 1s ease',
    });

    Object.assign(blob2.style, {
        position: 'absolute',
        width: '50vw',
        height: '50vw',
        borderRadius: '50%',
        filter: 'blur(140px)',
        bottom: '-15%',
        right: '-10%',
        transition: 'background 1s ease',
    });

    container.appendChild(blob1);
    container.appendChild(blob2);
    document.body.appendChild(container);

    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);
    let particles = [];
    let mouse = { x: null, y: null, targetX: null, targetY: null };
    let frameId = null;
    let isDark = document.documentElement.classList.contains('dark');

    // Setup blob colors based on theme
    function updateThemeColors() {
        isDark = document.documentElement.classList.contains('dark');
        if (isDark) {
            blob1.style.background = 'radial-gradient(circle, rgba(99, 102, 241, 0.1) 0%, rgba(99, 102, 241, 0) 70%)';
            blob2.style.background = 'radial-gradient(circle, rgba(19, 91, 236, 0.08) 0%, rgba(19, 91, 236, 0) 70%)';
        } else {
            blob1.style.background = 'radial-gradient(circle, rgba(99, 102, 241, 0.05) 0%, rgba(99, 102, 241, 0) 70%)';
            blob2.style.background = 'radial-gradient(circle, rgba(19, 91, 236, 0.04) 0%, rgba(19, 91, 236, 0) 70%)';
        }
    }
    updateThemeColors();

    // Listen for theme mutations
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                updateThemeColors();
            }
        });
    });
    observer.observe(document.documentElement, { attributes: true });

    // Particle class definition
    class Particle {
        constructor() {
            this.reset();
        }

        reset() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            // Extremely gentle, premium drift speeds
            this.vx = (Math.random() - 0.5) * 0.35;
            this.vy = (Math.random() - 0.5) * 0.35;
            this.radius = Math.random() * 1.5 + 1; // 1px to 2.5px
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;

            // Handle boundaries with smooth bouncing
            if (this.x < 0 || this.x > width) this.vx *= -1;
            if (this.y < 0 || this.y > height) this.vy *= -1;

            // Subtle attraction to mouse cursor if within range
            if (mouse.x !== null) {
                const dx = mouse.x - this.x;
                const dy = mouse.y - this.y;
                const dist = Math.hypot(dx, dy);
                if (dist < 180) {
                    const force = (180 - dist) / 180;
                    this.x += dx * force * 0.004;
                    this.y += dy * force * 0.004;
                }
            }
        }
    }

    // Initialize/Re-initialize particles depending on device size
    function initParticles() {
        particles = [];
        // Responsive particle density
        const baseDensity = width < 768 ? 20 : 65;
        for (let i = 0; i < baseDensity; i++) {
            particles.push(new Particle());
        }
    }
    initParticles();

    // Parallax mouse variables
    let mouseParallaxX = 0;
    let mouseParallaxY = 0;

    // Handle mouse tracking
    window.addEventListener('mousemove', (e) => {
        mouse.targetX = e.clientX;
        mouse.targetY = e.clientY;
    });

    window.addEventListener('mouseleave', () => {
        mouse.targetX = null;
        mouse.targetY = null;
    });

    // Handle window resize with a simple debounce check
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
            initParticles();
        }, 150);
    });

    // Main animation loop
    function animate() {
        if (document.visibilityState === 'hidden') {
            frameId = requestAnimationFrame(animate);
            return;
        }

        ctx.clearRect(0, 0, width, height);

        // Interpolate mouse coordinates for fluid, lagging follow effect
        if (mouse.targetX !== null) {
            if (mouse.x === null) {
                mouse.x = mouse.targetX;
                mouse.y = mouse.targetY;
            } else {
                mouse.x += (mouse.targetX - mouse.x) * 0.08;
                mouse.y += (mouse.targetY - mouse.y) * 0.08;
            }
            // Ambient parallax movement for blobs
            mouseParallaxX += ((mouse.targetX / width - 0.5) * 30 - mouseParallaxX) * 0.05;
            mouseParallaxY += ((mouse.targetY / height - 0.5) * 30 - mouseParallaxY) * 0.05;
        } else {
            mouse.x = null;
            mouse.y = null;
            // Float back to center
            mouseParallaxX += (0 - mouseParallaxX) * 0.02;
            mouseParallaxY += (0 - mouseParallaxY) * 0.02;
        }

        // Apply smooth parallax transformations to background blobs
        blob1.style.transform = `translate(${mouseParallaxX}px, ${mouseParallaxY}px)`;
        blob2.style.transform = `translate(${-mouseParallaxX}px, ${-mouseParallaxY}px)`;

        // Particle configuration colors based on dark mode status
        const particleColor = isDark ? 'rgba(147, 197, 253, 0.45)' : 'rgba(19, 91, 236, 0.3)';
        const lineColorPrefix = isDark ? 'rgba(99, 102, 241, ' : 'rgba(19, 91, 236, ';
        const maxLineDistance = 110;

        // Draw and update particle connections
        for (let i = 0; i < particles.length; i++) {
            const p1 = particles[i];
            p1.update();

            // Draw particle node
            ctx.beginPath();
            ctx.arc(p1.x, p1.y, p1.radius, 0, Math.PI * 2);
            ctx.fillStyle = particleColor;
            ctx.fill();

            // Connect lines between close particles
            for (let j = i + 1; j < particles.length; j++) {
                const p2 = particles[j];
                const dx = p1.x - p2.x;
                const dy = p1.y - p2.y;
                const dist = Math.hypot(dx, dy);

                if (dist < maxLineDistance) {
                    const opacity = (1 - dist / maxLineDistance) * 0.16;
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.strokeStyle = `${lineColorPrefix}${opacity})`;
                    ctx.lineWidth = 0.85;
                    ctx.stroke();
                }
            }

            // Draw link to user mouse cursor
            if (mouse.x !== null) {
                const dx = p1.x - mouse.x;
                const dy = p1.y - mouse.y;
                const dist = Math.hypot(dx, dy);

                if (dist < 140) {
                    const opacity = (1 - dist / 140) * 0.28;
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(mouse.x, mouse.y);
                    ctx.strokeStyle = isDark ? `rgba(147, 197, 253, ${opacity})` : `rgba(19, 91, 236, ${opacity})`;
                    ctx.lineWidth = 1.1;
                    ctx.stroke();
                }
            }
        }

        frameId = requestAnimationFrame(animate);
    }

    frameId = requestAnimationFrame(animate);

    // Clean up if script runs again (e.g. browser sync live updates)
    window.addEventListener('beforeunload', () => {
        if (frameId) cancelAnimationFrame(frameId);
        observer.disconnect();
    });
})();
