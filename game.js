/**
 * NEON PANIC - Core Game Logic
 */

// Constants & Configuration
const CONFIG = {
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 600,
    PLAYER_SPEED: 4,
    BULLET_SPEED: 7,
    RELOAD_TIME: 2000,
    MAX_SHOTS: 5,
    ROOM_SIZE: 10,
    ENTITY_TYPES: {
        PLAYER: 'player',
        ENEMY: 'enemy',
        PROJECTILE: 'projectile',
        OBSTACLE: 'obstacle',
        BOSS: 'boss',
        KEY: 'key'
    }
};

// --- Utilities ---
const Utils = {
    distance(e1, e2) {
        return Math.sqrt((e1.x - e2.x) ** 2 + (e1.y - e2.y) ** 2);
    },
    clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    },
    randomRange(min, max) {
        return Math.random() * (max - min) + min;
    },
    // AABB overlap check between a point-box and obstacle entity
    rectOverlap(ax, ay, aw, ah, b) {
        return (ax - aw / 2) < (b.x + b.width / 2) &&
            (ax + aw / 2) > (b.x - b.width / 2) &&
            (ay - ah / 2) < (b.y + b.height / 2) &&
            (ay + ah / 2) > (b.y - b.height / 2);
    }
};

// --- Base Entity ---
class Entity {
    constructor(x, y, width, height, type) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.type = type;
        this.dead = false;
        this._trailTick = 0;

        this.domElement = document.createElement('div');
        this.domElement.classList.add('entity', type);
        this.updatePosition();
    }

    updatePosition() {
        this.domElement.style.left = `${this.x}px`;
        this.domElement.style.top = `${this.y}px`;
    }

    getBounds() {
        return {
            left: this.x - this.width / 2,
            right: this.x + this.width / 2,
            top: this.y - this.height / 2,
            bottom: this.y + this.height / 2
        };
    }

    checkCollision(other) {
        const b1 = this.getBounds();
        const b2 = other.getBounds();
        return b1.left < b2.right && b1.right > b2.left &&
            b1.top < b2.bottom && b1.bottom > b2.top;
    }

    destroy() {
        this.dead = true;
        if (this.domElement.parentNode) {
            this.domElement.parentNode.removeChild(this.domElement);
        }
    }

    // Spawn a fading ghost trail element every `freq` frames
    _spawnTrail(worldElement, color, freq = 4) {
        this._trailTick++;
        if (this._trailTick % freq !== 0) return;
        const ghost = document.createElement('div');
        ghost.className = 'entity-trail';
        ghost.style.left = `${this.x}px`;
        ghost.style.top = `${this.y}px`;
        ghost.style.width = `${this.width * 0.75}px`;
        ghost.style.height = `${this.height * 0.75}px`;
        ghost.style.background = color;
        ghost.style.boxShadow = `0 0 8px ${color}`;
        worldElement.appendChild(ghost);
        // Cleanup after animation - doubled to 360ms
        setTimeout(() => ghost.remove(), 360);
    }

    // Push this entity out of all overlapping entities in the list
    _resolveEntities(others) {
        for (const other of others) {
            if (other === this || other.dead || !this.checkCollision(other)) continue;
            const dx = this.x - other.x;
            const dy = this.y - other.y;
            const overlapX = (this.width / 2 + other.width / 2) - Math.abs(dx);
            const overlapY = (this.height / 2 + other.height / 2) - Math.abs(dy);

            if (overlapX < overlapY) {
                this.x += dx > 0 ? overlapX : -overlapX;
            } else {
                this.y += dy > 0 ? overlapY : -overlapY;
            }
        }
    }
}

// --- Projectile ---
class Projectile extends Entity {
    constructor(x, y, vx, vy, ownerType, color) {
        super(x, y, 12, 12, 'projectile');
        this.vx = vx;
        this.vy = vy;
        this.ownerType = ownerType;
        this.isPiercing = false;
        this.domElement.classList.add(ownerType === 'player' ? 'player-bullet' : 'enemy-bullet');
        // Apply colour override if provided (player bullets use their player colour)
        if (color) {
            this.domElement.style.background = color;
            this.domElement.style.boxShadow = `0 0 8px ${color}, 0 0 14px ${color}`;
        }
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.updatePosition();
        if (this.x < 0 || this.x > CONFIG.CANVAS_WIDTH ||
            this.y < 0 || this.y > CONFIG.CANVAS_HEIGHT) {
            this.destroy();
        }
    }

    // New method for handling hits
    hitEntity(entity) {
        if (this.isPiercing) {
            if (entity.type === 'boss' || entity instanceof KeyEnemy) {
                this.destroy();
                return 2; // Damage for high HP entities
            }
            return 1; // Pierces normal enemies
        } else {
            this.destroy();
            return 1;
        }
    }
}

// --- Player ---
class Player extends Entity {
    constructor(id, x, y, controls) {
        super(x, y, 24, 24, 'player');
        this.id = id;
        this.controls = controls;
        this.domElement.classList.add(id);

        this.speed = CONFIG.PLAYER_SPEED;
        this.shotsFired = 0;
        this.reloading = false;
        this.fireButtonDown = false; // Track button state for single-fire
        this.health = 1;
        this.lives = 3;
        this._color = id === 'p1' ? '#39FF14' : '#ffff00';
        this.attackType = 'normal';
        this.maxShots = CONFIG.MAX_SHOTS;

        this.arrow = document.createElement('div');
        this.arrow.classList.add('aim-arrow');
        this.domElement.appendChild(this.arrow);
        this.aimAngle = 0;

        this._buildAmmoRing();
        this._reloadStart = 0;
        this._reloadAnimFrame = null;
    }

    setColor(color) {
        this._color = color;
        if (!this.reloading && this._ammoArc) {
            this._ammoArc.setAttribute('stroke', color);
        }
        this.updateLivesUI();
    }

    updateLivesUI() {
        const container = document.getElementById(`${this.id}-lives`);
        if (!container) return;
        const squares = container.querySelectorAll('.life-square');
        squares.forEach((sq, i) => {
            sq.style.backgroundColor = i < this.lives ? this._color : 'transparent';
            sq.style.boxShadow = i < this.lives ? `0 0 5px ${this._color}` : 'none';
            sq.style.opacity = i < this.lives ? '1' : '0.2';
        });
    }

    _buildAmmoRing() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '60');
        svg.setAttribute('height', '60');
        svg.style.cssText = 'position:absolute;left:-18px;top:-18px;overflow:visible;pointer-events:none;z-index:55';

        const R = 22, cx = 30, cy = 30;
        const circ = 2 * Math.PI * R;

        const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        track.setAttribute('cx', cx); track.setAttribute('cy', cy); track.setAttribute('r', R);
        track.setAttribute('fill', 'none');
        track.setAttribute('stroke', 'rgba(255,255,255,0.1)');
        track.setAttribute('stroke-width', '3');

        const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        arc.setAttribute('cx', cx); arc.setAttribute('cy', cy); arc.setAttribute('r', R);
        arc.setAttribute('fill', 'none');
        arc.setAttribute('stroke', this._color);
        arc.setAttribute('stroke-width', '3');
        arc.setAttribute('stroke-dasharray', circ);
        arc.setAttribute('stroke-dashoffset', '0');
        arc.setAttribute('stroke-linecap', 'round');
        arc.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);

        svg.appendChild(track);
        svg.appendChild(arc);
        this.domElement.appendChild(svg);

        this._ammoArc = arc;
        this._ammoCircumference = circ;
    }

    _updateAmmoRing() {
        if (!this._ammoArc || this.reloading) return;
        const fraction = (this.maxShots - this.shotsFired) / this.maxShots;
        this._ammoArc.setAttribute('stroke-dashoffset', this._ammoCircumference * (1 - fraction));
        this._ammoArc.setAttribute('stroke', this._color);
    }

    _animateReloadRing() {
        const duration = CONFIG.RELOAD_TIME;
        this._reloadStart = performance.now();
        this._ammoArc.setAttribute('stroke', '#ff0033');
        const animate = (now) => {
            if (!this.reloading) return;
            const t = Math.min((now - this._reloadStart) / duration, 1);
            this._ammoArc.setAttribute('stroke-dashoffset', this._ammoCircumference * (1 - t));
            if (t < 1) this._reloadAnimFrame = requestAnimationFrame(animate);
        };
        this._reloadAnimFrame = requestAnimationFrame(animate);
    }

    update(input, game) {
        if (this.dead) return;

        let dx = 0, dy = 0;
        if (input[this.controls.up]) dy -= 1;
        if (input[this.controls.down]) dy += 1;
        if (input[this.controls.left]) dx -= 1;
        if (input[this.controls.right]) dx += 1;

        if (dx !== 0 || dy !== 0) {
            const mag = Math.sqrt(dx * dx + dy * dy);
            this.x += (dx / mag) * this.speed;
            this.y += (dy / mag) * this.speed;
            this.aimAngle = Math.atan2(dy, dx);
        }

        const arrowDist = 20;
        this.arrow.style.transform =
            `translate(-50%,-50%) translate(${Math.cos(this.aimAngle) * arrowDist}px,${Math.sin(this.aimAngle) * arrowDist}px) rotate(${this.aimAngle * 180 / Math.PI + 90}deg)`;

        const isShooting = input[this.controls.shoot] || (this.controls.altShoot && input[this.controls.altShoot]);

        if (isShooting) {
            if (!this.fireButtonDown && !this.reloading) {
                this.shoot(game);
                this.fireButtonDown = true;
            }
        } else {
            this.fireButtonDown = false;
        }

        this.x = Utils.clamp(this.x, this.width / 2, CONFIG.CANVAS_WIDTH - this.width / 2);
        this.y = Utils.clamp(this.y, this.height / 2, CONFIG.CANVAS_HEIGHT - this.height / 2);

        // Obstacle resolution
        const obstacles = game.entities.filter(e => e.type === 'obstacle');
        this._resolveEntities(obstacles);

        // Trail
        this._spawnTrail(game.worldElement, this._color, 3);

        this._updateAmmoRing();
        this.updatePosition();
    }

    shoot(game) {
        if (this.reloading) return;

        if (this.attackType === 'shotgun') {
            const angles = [this.aimAngle, this.aimAngle - 0.2, this.aimAngle + 0.2];
            angles.forEach(angle => {
                const vx = Math.cos(angle) * CONFIG.BULLET_SPEED;
                const vy = Math.sin(angle) * CONFIG.BULLET_SPEED;
                const bullet = new Projectile(this.x, this.y, vx, vy, 'player', this._color);
                game.entities.push(bullet);
                game.worldElement.appendChild(bullet.domElement);
            });
        } else if (this.attackType === 'piercing') {
            const vx = Math.cos(this.aimAngle) * CONFIG.BULLET_SPEED;
            const vy = Math.sin(this.aimAngle) * CONFIG.BULLET_SPEED;
            const bullet = new Projectile(this.x, this.y, vx, vy, 'player', this._color);
            bullet.isPiercing = true;
            bullet.domElement.style.filter = 'drop-shadow(0 0 10px white)';
            game.entities.push(bullet);
            game.worldElement.appendChild(bullet.domElement);
        } else if (this.attackType === 'quad') {
            const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
            angles.forEach(angle => {
                const vx = Math.cos(angle) * CONFIG.BULLET_SPEED;
                const vy = Math.sin(angle) * CONFIG.BULLET_SPEED;
                const bullet = new Projectile(this.x, this.y, vx, vy, 'player', this._color);
                game.entities.push(bullet);
                game.worldElement.appendChild(bullet.domElement);
            });
        } else {
            const vx = Math.cos(this.aimAngle) * CONFIG.BULLET_SPEED;
            const vy = Math.sin(this.aimAngle) * CONFIG.BULLET_SPEED;
            const bullet = new Projectile(this.x, this.y, vx, vy, 'player', this._color);
            game.entities.push(bullet);
            game.worldElement.appendChild(bullet.domElement);
        }

        this.shotsFired++;
        this._updateAmmoRing();
        if (this.shotsFired >= this.maxShots) this.startReload();
    }

    startReload() {
        this.reloading = true;
        this._animateReloadRing();
        setTimeout(() => {
            this.reloading = false;
            this.shotsFired = 0;
            if (this._reloadAnimFrame) cancelAnimationFrame(this._reloadAnimFrame);
            this._ammoArc.setAttribute('stroke-dashoffset', '0');
            this._ammoArc.setAttribute('stroke', this._color);
        }, CONFIG.RELOAD_TIME);
    }

    die(game) {
        if (this.dead || this._invincible) return;
        this.lives--;
        this.updateLivesUI();

        if (this.lives > 0) {
            // Flash invincibility — don't go grey, just blink
            this._invincible = true;
            this.domElement.style.filter = 'brightness(3)';
            setTimeout(() => { this.domElement.style.filter = ''; }, 120);
            setTimeout(() => { this._invincible = false; }, 800);
        } else {
            // Final death
            this.health = 0;
            this.dead = true;
            this.domElement.classList.add('dead');
        }
    }

    revive() {
        this.health = 1;
        this.dead = false;
        this._invincible = false;
        this.domElement.classList.remove('dead');
        this.domElement.style.filter = '';
        this.shotsFired = 0;
        this.reloading = false;
        if (this._reloadAnimFrame) cancelAnimationFrame(this._reloadAnimFrame);
        this._ammoArc.setAttribute('stroke-dashoffset', '0');
        this._ammoArc.setAttribute('stroke', this._color);
    }

    resetLives() {
        this.lives = 3;
        this.updateLivesUI();
        if (this.dead) this.revive();
    }
}

// --- Enemy (Normal Shooter) ---
class Enemy extends Entity {
    constructor(x, y) {
        super(x, y, 40, 40, 'enemy');
        this.hp = 1;
        this.speed = 1.2;
        this.moveTimer = 0;
        this.dashTimer = 0;
        this.shootTimer = Utils.randomRange(100, 180); // Increased fire rate (was 180, 300)
        this.direction = { x: 0, y: 0 };
        this.active = false;
    }

    activate() {
        this.active = false;
        this.domElement.style.opacity = '0';
        setTimeout(() => {
            if (this.dead) return;
            this.active = true;
            this.domElement.style.opacity = '1';
            this.domElement.style.transition = 'opacity 0.5s';
        }, 1000);
    }

    update(players, game) {
        if (!this.active) return;

        this.moveTimer--;
        if (this.moveTimer <= 0) {
            const angle = Math.random() * Math.PI * 2;
            this.direction.x = Math.cos(angle);
            this.direction.y = Math.sin(angle);
            this.moveTimer = Utils.randomRange(30, 90);
        }

        this.dashTimer--;
        const spd = this.dashTimer > 0 ? this.speed * 2.5 : this.speed;
        if (this.dashTimer <= -90) this.dashTimer = 25;

        const nx = this.x + this.direction.x * spd;
        const ny = this.y + this.direction.y * spd;

        // Try full move, then axis-separated fallback (wall sliding)
        const obstacles = game.entities.filter(e => e.type === 'obstacle');
        const blocked = obstacles.some(o => Utils.rectOverlap(nx, ny, this.width, this.height, o));

        if (!blocked) {
            this.x = nx;
            this.y = ny;
        } else {
            // Try slide on X only
            const bx = obstacles.some(o => Utils.rectOverlap(nx, this.y, this.width, this.height, o));
            if (!bx) {
                this.x = nx;
            } else {
                // Try slide on Y only
                const by = obstacles.some(o => Utils.rectOverlap(this.x, ny, this.width, this.height, o));
                if (!by) {
                    this.y = ny;
                } else {
                    // Fully blocked — pick new direction
                    const angle = Math.random() * Math.PI * 2;
                    this.direction.x = Math.cos(angle);
                    this.direction.y = Math.sin(angle);
                    this.moveTimer = Utils.randomRange(20, 50);
                }
            }
        }

        // Enemy resolution (solid enemies)
        const enemies = game.entities.filter(e => e.type === 'enemy' || e.type === 'boss');
        this._resolveEntities(enemies);

        this.x = Utils.clamp(this.x, 20, CONFIG.CANVAS_WIDTH - 20);
        this.y = Utils.clamp(this.y, 20, CONFIG.CANVAS_HEIGHT - 20);

        // Shooting
        this.shootTimer--;
        if (this.shootTimer <= 0) {
            const alivePlayers = players.filter(p => !p.dead);
            if (alivePlayers.length > 0) {
                const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
                const angle = Math.atan2(target.y - this.y, target.x - this.x);
                const bullet = new Projectile(this.x, this.y, Math.cos(angle) * 4, Math.sin(angle) * 4, 'enemy', null);
                game.entities.push(bullet);
                game.worldElement.appendChild(bullet.domElement);
            }
            this.shootTimer = Utils.randomRange(80, 140); // Increased fire rate (was 160, 220)
        }

        // Trail
        this._spawnTrail(game.worldElement, '#ff0033', 5);
        this.updatePosition();
    }
}
// --- Zombie Enemy (Diamond, chases player, spawns in pairs) ---
class ZombieEnemy extends Entity {
    constructor(x, y) {
        super(x, y, 40, 40, 'enemy');
        this.hp = 1;
        this.speed = 1.0; // Slow movement
        this.active = false;
        this.domElement.classList.add('zombie-enemy');
        this.moveAngle = Math.random() * Math.PI * 2;
        this.shootTimer = Utils.randomRange(100, 180); // Same as normal Enemy
        this.circleDir = Math.random() > 0.5 ? 1 : -1;
    }

    activate(players) {
        this.active = false; // Stay inactive until timer in spawnLevelEntities
        this.domElement.style.opacity = '0';
    }

    update(players, game) {
        if (!this.active) return;

        // Circular movement logic
        this.moveAngle += 0.02 * this.circleDir;
        const vx = Math.cos(this.moveAngle) * this.speed;
        const vy = Math.sin(this.moveAngle) * this.speed;

        const nx = this.x + vx;
        const ny = this.y + vy;

        const obstacles = game.entities.filter(e => e.type === 'obstacle');
        const blocked = obstacles.some(o => Utils.rectOverlap(nx, ny, this.width, this.height, o));

        if (!blocked) {
            this.x = nx;
            this.y = ny;
        } else {
            // Reverse circle direction on hit
            this.circleDir *= -1;
            this.moveAngle += Math.PI; // Flip angle
        }

        // 4-way cross shooting
        this.shootTimer--;
        if (this.shootTimer <= 0) {
            const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
            angles.forEach(angle => {
                const bullet = new Projectile(this.x, this.y, Math.cos(angle) * 4, Math.sin(angle) * 4, 'enemy', null);
                game.entities.push(bullet);
                game.worldElement.appendChild(bullet.domElement);
            });
            this.shootTimer = Utils.randomRange(80, 140); // Same as normal Enemy
        }

        // Enemy resolution (solid enemies)
        const enemies = game.entities.filter(e => e.type === 'enemy' || e.type === 'boss');
        this._resolveEntities(enemies);

        this.x = Utils.clamp(this.x, 20, CONFIG.CANVAS_WIDTH - 20);
        this.y = Utils.clamp(this.y, 20, CONFIG.CANVAS_HEIGHT - 20);

        // Trail — darker red / magenta to distinguish from normal enemy
        this._spawnTrail(game.worldElement, '#cc0022', 4);
        this.updatePosition();
    }
}

// --- Key Enemy (Miniboss, Diamond, RGB, 6 hits) ---
class KeyEnemy extends Entity {
    constructor(x, y) {
        super(x, y, 45, 45, 'enemy');
        this.hp = 6;
        this.speed = 1.5;
        this.active = false;
        this.domElement.classList.add('zombie-enemy', 'rgb-pulse');
        this.moveAngle = Math.random() * Math.PI * 2;
        this.shootTimer = 60;
        this.patternIndex = 0; // Alternates between cardinal and diagonal
        this.circleDir = Math.random() > 0.5 ? 1 : -1;
    }

    activate() {
        this.active = false;
        this.domElement.style.opacity = '0';
    }

    update(players, game) {
        if (!this.active) return;

        // Circular movement
        this.moveAngle += 0.025 * this.circleDir;
        this.x += Math.cos(this.moveAngle) * this.speed;
        this.y += Math.sin(this.moveAngle) * this.speed;

        this.x = Utils.clamp(this.x, 60, CONFIG.CANVAS_WIDTH - 60);
        this.y = Utils.clamp(this.y, 60, CONFIG.CANVAS_HEIGHT - 60);

        // Shooting pattern
        this.shootTimer--;
        if (this.shootTimer <= 0) {
            const angles = this.patternIndex % 2 === 0
                ? [0, Math.PI / 2, Math.PI, -Math.PI / 2] // Cardinal
                : [Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4, -Math.PI / 4]; // Diagonal

            angles.forEach(angle => {
                const bullet = new Projectile(this.x, this.y, Math.cos(angle) * 5, Math.sin(angle) * 5, 'enemy', null);
                game.entities.push(bullet);
                game.worldElement.appendChild(bullet.domElement);
            });

            this.patternIndex++;
            this.shootTimer = 90;
        }

        // Resolution and Trail
        const others = game.entities.filter(e => (e.type === 'enemy' || e.type === 'boss' || e.type === 'obstacle') && e !== this);
        this._resolveEntities(others);
        this._spawnTrail(game.worldElement, '#ffffff', 3); // White trail for RGB enemy
        this.updatePosition();
    }

    die(game) {
        if (this.dead) return;
        this.dead = true;
        game.executeKeyDeath(this);
    }
}

// --- Boss ---
class Boss extends Entity {
    constructor(x, y, level) {
        super(x, y, 100, 100, 'boss');
        this.maxHp = 20 + level;
        this.hp = this.maxHp;
        this.attackTimer = 120;
        this.moveTimer = 0;
        this.moveAngle = Math.random() * Math.PI * 2;
        this.moveSpeed = 1.0;
        this.domElement.style.width = '100px';
        this.domElement.style.height = '100px';
    }

    update(players, game) {
        this.moveTimer--;
        if (this.moveTimer <= 0) {
            const cx = CONFIG.CANVAS_WIDTH / 2 - this.x;
            const cy = CONFIG.CANVAS_HEIGHT / 2 - this.y;
            const cd = Math.sqrt(cx * cx + cy * cy);
            const ra = Math.random() * Math.PI * 2;
            const w = Math.min(cd / 150, 1) * 0.4;
            const bx = Math.cos(ra) * (1 - w) + (cx / (cd || 1)) * w;
            const by = Math.sin(ra) * (1 - w) + (cy / (cd || 1)) * w;
            const mag = Math.sqrt(bx * bx + by * by);
            this.moveAngle = Math.atan2(by / mag, bx / mag);
            this.moveTimer = Utils.randomRange(40, 100);
        }

        this.x += Math.cos(this.moveAngle) * this.moveSpeed;
        this.y += Math.sin(this.moveAngle) * this.moveSpeed;
        this.x = Utils.clamp(this.x, 150, CONFIG.CANVAS_WIDTH - 150);
        this.y = Utils.clamp(this.y, 100, CONFIG.CANVAS_HEIGHT - 100);

        this.attackTimer--;
        if (this.attackTimer <= 0) {
            this.executeRandomAttack(game, players);
            this.attackTimer = 180;
        }

        this.updateHealthBar();
        this.updatePosition();
    }

    updateHealthBar() {
        const fill = document.getElementById('boss-health-fill');
        if (fill) fill.style.width = `${(this.hp / this.maxHp) * 100}%`;
    }

    executeRandomAttack(game, players) {
        const p = Math.floor(Math.random() * 3);
        if (p === 0) this.spawnCircular(game);
        else if (p === 1) this.spawnBurst(game, players);
        else this.spawnXPattern(game);
    }

    spawnCircular(game) {
        for (let i = 0; i < 12; i++) this.shootBullet(game, (i / 12) * Math.PI * 2);
    }

    spawnBurst(game, players) {
        const alive = players.filter(p => !p.dead);
        if (!alive.length) return;
        const base = Math.atan2(alive[0].y - this.y, alive[0].x - this.x);
        for (let i = -1; i <= 1; i++) this.shootBullet(game, base + i * 0.2);
    }

    spawnXPattern(game) {
        for (let i = 0; i < 4; i++) this.shootBullet(game, Math.PI / 4 + i * Math.PI / 2);
    }

    shootBullet(game, angle) {
        const bullet = new Projectile(
            this.x, this.y,
            Math.cos(angle) * 5, Math.sin(angle) * 5,
            'enemy', null
        );
        game.entities.push(bullet);
        game.worldElement.appendChild(bullet.domElement);
    }
}

// --- Obstacle ---
class Obstacle extends Entity {
    constructor(x, y, w, h) {
        super(x, y, w, h, 'obstacle');
        this.domElement.style.width = `${w}px`;
        this.domElement.style.height = `${h}px`;
    }
}

// --- Key ---
class Key extends Entity {
    constructor(x, y) {
        super(x, y, 30, 30, 'key');
        this.domElement.classList.add('rgb-pulse');
        // Static key item, no movement needed unless it's a pickup
    }

    update() {
        this.updatePosition();
    }
}

// --- Powerup ---
class Powerup extends Entity {
    constructor(x, y) {
        super(x, y, 32, 32, 'powerup');
        this.domElement.classList.add('rgb-pulse', 'powerup');
        this.domElement.style.borderRadius = '50%';
        this.domElement.style.width = '32px';
        this.domElement.style.height = '32px';
    }

    update() {
        this.updatePosition();
    }
}

// --- Trap ---
class Trap extends Entity {
    constructor(x, y) {
        super(x, y, 30, 30, 'trap');
        this.domElement.classList.add('trap');
    }

    update() {
        this.updatePosition();
    }
}

// --- Room ---
class Room {
    constructor(gridX, gridY) {
        this.gridX = gridX;
        this.gridY = gridY;
        this.cleared = false;
        this.type = 'normal';
        this.doors = { top: null, bottom: null, left: null, right: null };
        this.entities = [];
        this.layout = [];
        this.enemiesSpawned = false;
    }
}

// --- Dungeon Generator ---
class DungeonGenerator {
    static generate(level) {
        const rooms = new Map();
        const startRoom = new Room(0, 0);
        startRoom.type = 'start';
        startRoom.cleared = true;
        rooms.set('0,0', startRoom);

        let roomCoords = [[0, 0]];
        const maxRooms = 6 + level;

        while (roomCoords.length < maxRooms) {
            const current = roomCoords[Math.floor(Math.random() * roomCoords.length)];
            const neighbors = [[0, -1], [0, 1], [-1, 0], [1, 0]];
            const dir = neighbors[Math.floor(Math.random() * neighbors.length)];
            const nextX = current[0] + dir[0];
            const nextY = current[1] + dir[1];
            const key = `${nextX},${nextY}`;
            if (!rooms.has(key)) {
                rooms.set(key, new Room(nextX, nextY));
                roomCoords.push([nextX, nextY]);
            }
        }

        const normalRooms = roomCoords.filter(c => c[0] !== 0 || c[1] !== 0);

        // Pick Key and Boss rooms, ensuring they are not connected to start (0,0)
        // Distance must be > 1
        const pickSpecialRoom = () => {
            const potential = normalRooms.filter(c => (Math.abs(c[0]) + Math.abs(c[1])) > 1);
            if (potential.length > 0) {
                const picked = potential[Math.floor(Math.random() * potential.length)];
                const index = normalRooms.indexOf(picked);
                return normalRooms.splice(index, 1)[0];
            }
            return normalRooms.length > 0 ? normalRooms.pop() : [0, 0];
        };

        const bossCoord = pickSpecialRoom();
        const keyCoord = pickSpecialRoom();
        const treasureCoord = pickSpecialRoom();
        rooms.get(`${bossCoord[0]},${bossCoord[1]}`).type = 'boss';
        rooms.get(`${keyCoord[0]},${keyCoord[1]}`).type = 'key';
        rooms.get(`${treasureCoord[0]},${treasureCoord[1]}`).type = 'treasure';

        rooms.forEach((room, key) => {
            const [x, y] = key.split(',').map(Number);
            const checkDoor = (nx, ny) => {
                const n = rooms.get(`${nx},${ny}`);
                if (!n) return null;
                return n.type === 'boss' ? 'boss' : true;
            };
            room.doors.top = checkDoor(x, y - 1);
            room.doors.bottom = checkDoor(x, y + 1);
            room.doors.left = checkDoor(x - 1, y);
            room.doors.right = checkDoor(x + 1, y);
        });

        return rooms;
    }
}

// --- Game Engine ---
class GameEngine {
    constructor() {
        this.worldElement = document.getElementById('game-world');
        this.entities = [];
        this.players = [];
        this.input = {};
        this.state = 'START';
        this.level = 1;
        this.score = 0;
        this.multiplayer = false;
        this.rooms = null;
        this.currentRoom = null;
        this.hasKey = false;

        this.setupEventListeners();
        this.initLoop();
    }

    setupEventListeners() {
        window.addEventListener('keydown', e => {
            this.input[e.code] = true;
            if (e.code === 'KeyP') location.reload();
        });
        window.addEventListener('keyup', e => this.input[e.code] = false);

        document.getElementById('btn-start').onclick = () => this.showMainMenu();
        document.getElementById('btn-options').onclick = () => this.showOptionsMenu();
        document.getElementById('btn-options-back').onclick = () => this.showMainMenu();
        document.getElementById('btn-single').onclick = () => this.startGame(false);
        document.getElementById('btn-multi').onclick = () => this.startGame(true);
        document.getElementById('btn-resume').onclick = () => this.resumeGame();
        document.getElementById('btn-restart').onclick = () => this.doRestart();
        document.getElementById('btn-pause-exit').onclick = () => location.reload();
        document.getElementById('btn-game-over-exit').onclick = () => location.reload();

        // Color pickers — also update ammo ring
        document.getElementById('p1-color-picker').onchange = (e) => {
            if (this.players[0]) {
                const c = e.target.value;
                this.players[0].domElement.style.backgroundColor = c;
                this.players[0].domElement.style.boxShadow = `0 0 10px ${c}, 0 0 20px ${c}`;
                this.players[0].setColor(c);
            }
        };
        document.getElementById('p2-color-picker').onchange = (e) => {
            if (this.players[1]) {
                const c = e.target.value;
                this.players[1].domElement.style.backgroundColor = c;
                this.players[1].domElement.style.boxShadow = `0 0 10px ${c}, 0 0 20px ${c}`;
                this.players[1].setColor(c);
            }
        };

        window.addEventListener('keydown', e => {
            if (e.code === 'Escape') {
                if (this.state === 'PLAYING') this.pauseGame();
                else if (this.state === 'PAUSED') this.resumeGame();
            }
        });
    }

    showMainMenu() {
        this.state = 'MENU';
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('options-menu').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
    }

    showOptionsMenu() {
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('options-menu').classList.remove('hidden');
    }

    startGame(multi) {
        this.multiplayer = multi;
        this.state = 'PLAYING';
        document.getElementById('menu-overlay').classList.add('hidden');
        document.getElementById('main-menu').classList.add('hidden');
        this.resetGame();
    }

    doRestart() {
        this.state = 'PLAYING';
        document.getElementById('menu-overlay').classList.add('hidden');
        document.getElementById('game-over-menu').classList.add('hidden');
        document.getElementById('game-over-buttons').classList.add('hidden');
        this.resetGame();
    }

    resetGame() {
        this.level = 1;
        this.score = 0;
        this.hasKey = false;
        document.getElementById('game-over-menu').classList.add('hidden');
        document.getElementById('menu-overlay').classList.add('hidden');
        document.getElementById('boss-health-container').classList.add('hidden');
        this.initDungeon();
        this.showAnnouncement('LEVEL 1');
    }

    initDungeon() {
        this.rooms = DungeonGenerator.generate(this.level);
        this.currentRoom = this.rooms.get('0,0');
        this.hasKey = false;
        this.spawnPlayers();
        this.loadRoom();
    }

    spawnPlayers() {
        this.entities = [];
        this.worldElement.innerHTML = '';

        const p1 = new Player('p1', 400, 300, {
            up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
            shoot: 'Space', altShoot: 'Enter'
        });
        const p1Color = document.getElementById('p1-color-picker').value;
        p1.domElement.style.backgroundColor = p1Color;
        p1.domElement.style.boxShadow = `0 0 10px ${p1Color}, 0 0 20px ${p1Color}`;
        p1.setColor(p1Color);
        p1.updateLivesUI();

        this.players = [p1];
        this.entities.push(p1);
        this.worldElement.appendChild(p1.domElement);

        if (this.multiplayer) {
            const p2 = new Player('p2', 450, 300, {
                up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
                shoot: 'CapsLock', altShoot: 'Digit1'
            });
            const p2Color = document.getElementById('p2-color-picker').value;
            p2.domElement.style.backgroundColor = p2Color;
            p2.domElement.style.boxShadow = `0 0 10px ${p2Color}, 0 0 20px ${p2Color}`;
            p2.setColor(p2Color);
            p2.updateLivesUI();

            this.players.push(p2);
            this.entities.push(p2);
            this.worldElement.appendChild(p2.domElement);
            document.getElementById('p2-stats').classList.remove('hidden');
        }
    }

    loadRoom() {
        this.entities = this.entities.filter(e => e.type === 'player');

        const playerEls = this.players.map(p => p.domElement);
        Array.from(this.worldElement.childNodes).forEach(n => {
            if (!playerEls.includes(n)) n.remove();
        });

        this.spawnDoors();
        this.spawnObstacles();
        this.spawnRoomWalls();

        if (!this.currentRoom.cleared) {
            this.spawnLevelEntities();
        }

        document.getElementById('current-level').innerText = `LEVEL: ${this.level}`;
        document.getElementById('current-score').innerText = `SCORE: ${this.score}`;
    }

    spawnDoors() {
        const positions = {
            top: { x: 400, y: 0, w: 80, h: 50 },
            bottom: { x: 400, y: 600, w: 80, h: 50 },
            left: { x: 0, y: 300, w: 50, h: 80 },
            right: { x: 800, y: 300, w: 50, h: 80 }
        };

        for (const [dir, active] of Object.entries(this.currentRoom.doors)) {
            if (!active) continue;
            const pos = positions[dir];
            const door = document.createElement('div');
            door.classList.add('door', 'open');
            door.style.left = `${pos.x}px`;
            door.style.top = `${pos.y}px`;
            door.style.width = `${pos.w}px`;
            door.style.height = `${pos.h}px`;
            door.style.transform = 'translate(-50%,-50%)';
            door.dataset.dir = dir;
            if (this.currentRoom.doors[dir] === 'boss') door.classList.add('rgb-pulse');
            this.worldElement.appendChild(door);
        }
    }

    spawnObstacles() {
        if (this.currentRoom.type === 'boss' || this.currentRoom.type === 'key' || this.currentRoom.type === 'treasure') return;

        // Use stored layout if it exists
        if (!this.currentRoom.layout || this.currentRoom.layout.length === 0) {
            const OW = 100, OH = 80;
            const patternType = Math.floor(Math.random() * 3);
            let positions = [];

            if (patternType === 0) {
                positions = [160, 400, 640].map(x => ({ x, y: 300 }));
            } else if (patternType === 1) {
                positions = [140, 460].map(y => ({ x: 400, y }));
            } else {
                positions = [
                    { x: 180, y: 150 },
                    { x: 400, y: 300 },
                    { x: 620, y: 450 }
                ];
            }

            this.currentRoom.layout = [];
            for (const pos of positions) {
                // Skips central obstacle if it's the start room or randomly based on rules
                if (pos.x === 400 && pos.y === 300) {
                    if (this.currentRoom.type === 'start' || Math.random() < 0.5) continue;
                }
                this.currentRoom.layout.push({ ...pos, w: OW, h: OH });
            }
        }

        for (const item of this.currentRoom.layout) {
            const obs = new Obstacle(item.x, item.y, item.w, item.h);
            obs.domElement.classList.add('neon-obstacle');
            this.entities.push(obs);
            this.worldElement.appendChild(obs.domElement);
        }
    }

    spawnRoomWalls() {
        // Border walls (solid obstacles like the others)
        const wallThickness = 20;
        const W = CONFIG.CANVAS_WIDTH;
        const H = CONFIG.CANVAS_HEIGHT;

        // Top wall (split in half for door)
        if (!this.currentRoom.doors.top) {
            this._addWall(W / 2, wallThickness / 2, W, wallThickness);
        } else {
            this._addWall(180, wallThickness / 2, 360, wallThickness);
            this._addWall(620, wallThickness / 2, 360, wallThickness);
        }

        // Bottom wall
        if (!this.currentRoom.doors.bottom) {
            this._addWall(W / 2, H - wallThickness / 2, W, wallThickness);
        } else {
            this._addWall(180, H - wallThickness / 2, 360, wallThickness);
            this._addWall(620, H - wallThickness / 2, 360, wallThickness);
        }

        // Left wall
        if (!this.currentRoom.doors.left) {
            this._addWall(wallThickness / 2, H / 2, wallThickness, H);
        } else {
            this._addWall(wallThickness / 2, 130, wallThickness, 260);
            this._addWall(wallThickness / 2, 470, wallThickness, 260);
        }

        // Right wall
        if (!this.currentRoom.doors.right) {
            this._addWall(W - wallThickness / 2, H / 2, wallThickness, H);
        } else {
            this._addWall(W - wallThickness / 2, 130, wallThickness, 260);
            this._addWall(W - wallThickness / 2, 470, wallThickness, 260);
        }
    }

    _addWall(x, y, w, h) {
        const wall = new Obstacle(x, y, w, h);
        wall.domElement.classList.add('neon-obstacle', 'room-wall');
        this.entities.push(wall);
        this.worldElement.appendChild(wall.domElement);
    }

    // Find a position (cx,cy) that doesn't overlap any current obstacles
    _findSafeSpot(cx, cy, w, h, fallbacks) {
        const obs = this.entities.filter(e => e.type === 'obstacle');
        const overlaps = (x, y) => obs.some(o => Utils.rectOverlap(x, y, w, h, o));
        if (!overlaps(cx, cy)) return { x: cx, y: cy };
        for (const fb of fallbacks) {
            if (!overlaps(fb.x, fb.y)) return fb;
        }
        return { x: cx, y: cy }; // last resort
    }

    spawnLevelEntities() {
        if (this.currentRoom.type === 'normal') {
            const count = 3 + Math.floor(Math.random() * 2);
            const spawned = [];

            for (let i = 0; i < count; i++) {
                const isZombie = Math.random() < 0.30;
                let spawnX, spawnY;
                // Ensure safe zone around ALL players
                let isTooClose = true;
                let attempts = 0;
                while (isTooClose && attempts < 50) {
                    spawnX = Utils.randomRange(100, CONFIG.CANVAS_WIDTH - 100);
                    spawnY = Utils.randomRange(100, CONFIG.CANVAS_HEIGHT - 100);
                    isTooClose = this.players.some(p => Utils.distance({ x: spawnX, y: spawnY }, p) < 150);
                    attempts++;
                }

                if (isZombie) {
                    const safe = this._findSafeSpot(spawnX, spawnY, 40, 40, [
                        { x: 100, y: 100 }, { x: 700, y: 100 },
                        { x: 100, y: 500 }, { x: 700, y: 500 }
                    ]);
                    const z = new ZombieEnemy(safe.x, safe.y);
                    z.activate(this.players);
                    this.entities.push(z);
                    this.worldElement.appendChild(z.domElement);
                    spawned.push(z);
                } else {
                    const safe = this._findSafeSpot(spawnX, spawnY, 40, 40, [
                        { x: 100, y: 100 }, { x: 700, y: 100 },
                        { x: 100, y: 500 }, { x: 700, y: 500 }
                    ]);
                    const enemy = new Enemy(safe.x, safe.y);
                    this.entities.push(enemy);
                    this.worldElement.appendChild(enemy.domElement);
                    spawned.push(enemy);
                }
            }

            this.lockDoors();

            // Spawn Traps
            const trapCount = Math.floor(Math.random() * 2) + 1; // 1 to 2 traps
            for (let i = 0; i < trapCount; i++) {
                let tx, ty;
                let tooClose = true;
                let attempts = 0;
                while (tooClose && attempts < 50) {
                    tx = Utils.randomRange(100, CONFIG.CANVAS_WIDTH - 100);
                    ty = Utils.randomRange(100, CONFIG.CANVAS_HEIGHT - 100);
                    // Distance from players
                    const pDist = this.players.some(p => Utils.distance({ x: tx, y: ty }, p) < 150);
                    // Distance from doors (using center points)
                    const doorPos = [{ x: 400, y: 0 }, { x: 400, y: 600 }, { x: 0, y: 300 }, { x: 800, y: 300 }];
                    const dDist = doorPos.some(d => Utils.distance({ x: tx, y: ty }, d) < 120);
                    tooClose = pDist || dDist;
                    attempts++;
                }
                const trap = new Trap(tx, ty);
                this.entities.push(trap);
                this.worldElement.appendChild(trap.domElement);
            }

            setTimeout(() => {
                spawned.forEach(e => {
                    e.active = true;
                    e.domElement.style.opacity = '1';
                    e.domElement.style.transition = 'opacity 0.5s';
                });
            }, 1000);

        } else if (this.currentRoom.type === 'key') {
            const safe = this._findSafeSpot(400, 300, 45, 45, [
                { x: 200, y: 150 }, { x: 600, y: 150 }
            ]);
            const keyEnemy = new KeyEnemy(safe.x, safe.y);
            this.entities.push(keyEnemy);
            this.worldElement.appendChild(keyEnemy.domElement);
            this.lockDoors();

            setTimeout(() => {
                keyEnemy.active = true;
                keyEnemy.domElement.style.opacity = '1';
                keyEnemy.domElement.style.transition = 'opacity 0.5s';
            }, 1000);
        } else if (this.currentRoom.type === 'boss') {
            const boss = new Boss(400, 300, this.level);
            boss.active = false;
            boss.domElement.style.opacity = '0';
            this.entities.push(boss);
            this.worldElement.appendChild(boss.domElement);
            document.getElementById('boss-health-container').classList.remove('hidden');
            this.lockDoors();

            setTimeout(() => {
                boss.active = true;
                boss.domElement.style.opacity = '1';
                boss.domElement.style.transition = 'opacity 0.5s';
            }, 1000);
        } else if (this.currentRoom.type === 'treasure') {
            const p = new Powerup(400, 300);
            this.entities.push(p);
            this.worldElement.appendChild(p.domElement);
        }
    }

    lockDoors() {
        document.querySelectorAll('.door').forEach(d => {
            d.classList.remove('open');
            d.classList.add('locked');
        });
    }

    unlockDoors() {
        document.querySelectorAll('.door').forEach(d => {
            d.classList.remove('locked');
            d.classList.add('open');
        });
    }

    update() {
        if (this.state !== 'PLAYING') return;

        this.entities.forEach(ent => {
            if (ent.type === 'player') ent.update(this.input, this);
            if (ent.type === 'enemy') ent.update(this.players, this);
            if (ent.type === 'projectile') ent.update();
            if (ent.type === 'boss' || ent.type === 'key') ent.update(this.players, this);
        });

        this.handleCollisions();
        this.handleDoors();

        this.entities = this.entities.filter(e => !e.dead);

        const enemiesAlive = this.entities.some(e => e.type === 'enemy' || e.type === 'boss');
        if (!enemiesAlive && !this.currentRoom.cleared) {
            this.currentRoom.cleared = true;
            this.onRoomCleared();
        }

        if (this.players.every(p => p.dead && p.lives === 0)) this.gameOver();
    }

    handleCollisions() {
        for (let i = 0; i < this.entities.length; i++) {
            for (let j = i + 1; j < this.entities.length; j++) {
                const e1 = this.entities[i];
                const e2 = this.entities[j];
                if (e1.checkCollision(e2)) this.onCollision(e1, e2);
            }
        }
    }

    onCollision(e1, e2) {
        // ... (existing code, added Player vs Trap)
        const types = [e1.type, e2.type];
        const getPair = (t1, t2) => {
            if (types[0] === t1 && types[1] === t2) return [e1, e2];
            if (types[0] === t2 && types[1] === t1) return [e2, e1];
            return null;
        };

        let pair;

        // Player vs Trap
        pair = getPair('player', 'trap');
        if (pair) {
            const [player] = pair;
            if (!player.dead) {
                this.createDeathParticles(player.x, player.y, 15);
                player.die(this);
            }
            return;
        }

        // Bullet vs Enemy
        pair = getPair('projectile', 'enemy');
        if (pair) {
            const [bullet, enemy] = pair;
            if (bullet.ownerType === 'player') {
                this.createSparkParticles(bullet.x, bullet.y, '#ff6600');
                const damage = bullet.hitEntity(enemy);

                enemy.hp -= damage;
                if (enemy.hp <= 0) {
                    this.createDeathParticles(enemy.x, enemy.y);
                    if (enemy instanceof KeyEnemy) {
                        enemy.die(this);
                    } else {
                        enemy.destroy();
                    }
                    this.score += 100;
                }
            }
            return;
        }

        // Bullet vs Boss
        pair = getPair('projectile', 'boss');
        if (pair) {
            const [bullet, boss] = pair;
            if (bullet.ownerType === 'player') {
                this.createSparkParticles(bullet.x, bullet.y, '#ff00ff');
                const damage = bullet.hitEntity(boss);
                boss.hp -= damage;
                if (boss.hp <= 0 && !boss.dead) {
                    boss.dead = true;
                    this.executeBossDeath(boss);
                }
            }
            return;
        }

        // Bullet vs Player
        pair = getPair('projectile', 'player');
        if (pair) {
            const [bullet, player] = pair;
            if (bullet.ownerType === 'enemy' && !player.dead) {
                this.createSparkParticles(bullet.x, bullet.y, '#ff0033');
                bullet.destroy();
                player.die(this);
            }
            return;
        }

        // Bullet vs Obstacle
        pair = getPair('projectile', 'obstacle');
        if (pair) {
            const [bullet] = pair;
            this.createSparkParticles(bullet.x, bullet.y, '#4488aa');
            bullet.destroy();
            return;
        }

        // Player vs Enemy — physical contact drains all lives instantly
        pair = getPair('player', 'enemy');
        if (pair) {
            const [player] = pair;
            if (!player.dead && !player._invincible) {
                this.createDeathParticles(player.x, player.y, 20);
                player.lives = 1; // set to 1 so die() final branch triggers
                player.die(this);
            }
            return;
        }

        // Player vs Key
        pair = getPair('player', 'key');
        if (pair) {
            const [, key] = pair;
            key.destroy();
            this.hasKey = true;
            this.score += 500;
            this.showAnnouncement('KEY COLLECTED');
            return;
        }

        // Player vs Powerup
        pair = getPair('player', 'powerup');
        if (pair) {
            const [player, powerup] = pair;
            powerup.destroy();
            this.applyRandomPowerup(player);
            return;
        }
    }

    applyRandomPowerup(player) {
        const types = [
            { type: 'shotgun', maxShots: 2, msg: 'SHOTGUN UNLOCKED' },
            { type: 'piercing', maxShots: 3, msg: 'PIERCING UNLOCKED' },
            { type: 'quad', maxShots: 3, msg: 'QUAD UNLOCKED' }
        ];
        // Exclude currently active attack type so the player always gets something new
        const choices = types.filter(t => t.type !== player.attackType);
        const picked = choices[Math.floor(Math.random() * choices.length)];
        player.attackType = picked.type;
        player.maxShots = picked.maxShots;
        this.showAnnouncement(picked.msg);
        player.shotsFired = 0;
        player._updateAmmoRing();
    }

    handleDoors() {
        if (!this.currentRoom.cleared) return;
        this.players.forEach(p => {
            document.querySelectorAll('.door.open').forEach(d => {
                const br = d.getBoundingClientRect();
                const gr = this.worldElement.getBoundingClientRect();
                const dx = br.left - gr.left + br.width / 2;
                const dy = br.top - gr.top + br.height / 2;
                if (Math.abs(p.x - dx) < 40 && Math.abs(p.y - dy) < 40) {
                    this.changeRoom(d.dataset.dir);
                }
            });
        });
    }

    changeRoom(dir) {
        let [x, y] = [this.currentRoom.gridX, this.currentRoom.gridY];
        if (dir === 'top') y--;
        if (dir === 'bottom') y++;
        if (dir === 'left') x--;
        if (dir === 'right') x++;

        const nextRoom = this.rooms.get(`${x},${y}`);
        if (!nextRoom) return;
        if (nextRoom.type === 'boss' && !this.hasKey) return;

        this.currentRoom = nextRoom;
        this.players.forEach(p => {
            if (dir === 'top') { p.x = 400; p.y = 550; }
            if (dir === 'bottom') { p.x = 400; p.y = 50; }
            if (dir === 'left') { p.x = 750; p.y = 300; }
            if (dir === 'right') { p.x = 50; p.y = 300; }
        });
        this.loadRoom();
    }

    nextLevel() {
        this.level++;
        // Reload all players to max lives
        this.players.forEach(p => p.resetLives());
        this.showAnnouncement(`LEVEL ${this.level}`);
        this.initDungeon();
    }

    showAnnouncement(text) {
        const layer = document.getElementById('announcement-layer');
        if (!layer) return;
        layer.innerHTML = '';
        const el = document.createElement('div');
        el.className = 'announcement-text glitch fade-out-glitch';
        el.innerText = text;
        layer.appendChild(el);
        setTimeout(() => el.remove(), 2500);
    }

    createDeathParticles(x, y, count = 10) {
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.classList.add('particle');
            p.style.left = `${x}px`;
            p.style.top = `${y}px`;
            p.style.setProperty('--tx', `${Utils.randomRange(-100, 100)}px`);
            p.style.setProperty('--ty', `${Utils.randomRange(-100, 100)}px`);
            this.worldElement.appendChild(p);
            setTimeout(() => p.remove(), 500);
        }
    }

    createSparkParticles(x, y, color = '#ffffff') {
        const count = (Utils.randomRange(4, 8)) | 0;
        for (let i = 0; i < count; i++) {
            const s = document.createElement('div');
            s.classList.add('spark-particle');
            s.style.left = `${x}px`;
            s.style.top = `${y}px`;
            s.style.background = color;
            s.style.boxShadow = `0 0 4px ${color}`;
            const angle = Math.random() * Math.PI * 2;
            const dist = Utils.randomRange(15, 50);
            s.style.setProperty('--sx', `${Math.cos(angle) * dist}px`);
            s.style.setProperty('--sy', `${Math.sin(angle) * dist}px`);
            const size = Math.random() > 0.5 ? 3 : 2;
            s.style.width = `${size}px`;
            s.style.height = `${size}px`;
            this.worldElement.appendChild(s);
            setTimeout(() => s.remove(), 300);
        }
    }

    onRoomCleared() {
        this.unlockDoors();
        if (this.multiplayer) {
            this.players.forEach(p => {
                if (p.dead && p.lives === 0) {
                    // Restore 1 life as a reward for the surviving partner
                    p.lives = 1;
                    p.updateLivesUI();
                    p.revive();
                    p.x = CONFIG.CANVAS_WIDTH / 2;
                    p.y = CONFIG.CANVAS_HEIGHT / 2;
                    if (!this.entities.includes(p)) this.entities.push(p);
                }
            });
        }
    }

    gameOver() {
        if (this.state === 'GAMEOVER') return;
        this.state = 'GAMEOVER';
        setTimeout(() => {
            document.getElementById('menu-overlay').classList.remove('hidden');
            document.getElementById('game-over-menu').classList.remove('hidden');
            document.getElementById('final-score').innerText = this.score;
            document.getElementById('final-levels').innerText = this.level - 1;
            setTimeout(() => {
                document.getElementById('game-over-buttons').classList.remove('hidden');
            }, 2000);
        }, 1500);
    }

    executeKeyDeath(enemy) {
        // Explosion for 0.5s then spawn key
        this.createDeathParticles(enemy.x, enemy.y, 20);
        setTimeout(() => {
            enemy.destroy();
            const keyItem = new Key(enemy.x, enemy.y);
            this.entities.push(keyItem);
            this.worldElement.appendChild(keyItem.domElement);
        }, 500);
    }

    executeBossDeath(boss) {
        // Multiple explosions for 1s
        const interval = setInterval(() => {
            this.createDeathParticles(
                boss.x + Utils.randomRange(-50, 50),
                boss.y + Utils.randomRange(-50, 50),
                10
            );
        }, 100);

        setTimeout(() => {
            clearInterval(interval);
            boss.destroy();
            this.score += 2000;
            document.getElementById('boss-health-container').classList.add('hidden');
            this.showAnnouncement('LEVEL COMPLETED!');

            // Black transition
            const overlay = document.getElementById('level-transition-overlay');
            overlay.classList.remove('hidden');
            overlay.style.opacity = '1';

            setTimeout(() => {
                this.nextLevel();
                setTimeout(() => {
                    overlay.style.opacity = '0';
                    setTimeout(() => overlay.classList.add('hidden'), 500);
                }, 1000);
            }, 1500);
        }, 1000);
    }

    pauseGame() {
        this.state = 'PAUSED';
        document.getElementById('menu-overlay').classList.remove('hidden');
        document.getElementById('pause-menu').classList.remove('hidden');
    }

    resumeGame() {
        this.state = 'PLAYING';
        document.getElementById('menu-overlay').classList.add('hidden');
        document.getElementById('pause-menu').classList.add('hidden');
    }

    initLoop() {
        const loop = () => { this.update(); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
    }
}

window.onload = () => { window.game = new GameEngine(); };
