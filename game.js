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

        // Circular ground shadow for characters
        if (type === 'player' || type === 'enemy' || type === 'boss') {
            const shadow = document.createElement('div');
            shadow.classList.add('entity-shadow');
            this.domElement.appendChild(shadow);
        }

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
    constructor(x, y, vx, vy, ownerType, color, owner = null) {
        super(x, y, 12, 12, 'projectile');
        this.vx = vx;
        this.vy = vy;
        this.ownerType = ownerType;
        this.owner = owner;
        this.isPiercing = false;
        this.isBoomerang = false;
        this.isRicochet = false;
        this.bounces = 0;
        this.traveled = 0;
        this.returning = false;
        this._isInside = false; // Track for piercing particles
        this._lastPos = { x, y };

        this.domElement.classList.add(ownerType === 'player' ? 'player-bullet' : 'enemy-bullet');
        if (color) {
            this.domElement.style.background = color;
            this.domElement.style.boxShadow = `0 0 8px ${color}, 0 0 14px ${color}`;
        }
    }

    update(game, dtScale) {
        this._lastPos = { x: this.x, y: this.y };
        this.x += this.vx * dtScale;
        this.y += this.vy * dtScale;

        const dist = Math.sqrt((this.x - this._lastPos.x) ** 2 + (this.y - this._lastPos.y) ** 2);
        this.traveled += dist;

        if (this.isPiercing) {
            const obstacles = game.entities.filter(e => e.type === 'obstacle');
            const collidingNow = obstacles.some(o => this.checkCollision(o));
            if (collidingNow && !this._isInside) {
                // Just entered
                game.createSparkParticles(this.x, this.y, '#ffffff');
                this._isInside = true;
            } else if (!collidingNow && this._isInside) {
                // Just exited
                game.createSparkParticles(this.x, this.y, '#ffffff');
                this._isInside = false;
            }
        }

        if (this.isBoomerang) {
            if (!this.returning && this.traveled > 250) {
                this.returning = true;
            }
            if (this.returning && this.owner) {
                const angle = Math.atan2(this.owner.y - this.y, this.owner.x - this.x);
                this.vx = Math.cos(angle) * CONFIG.BULLET_SPEED;
                this.vy = Math.sin(angle) * CONFIG.BULLET_SPEED;
                if (Utils.distance(this, this.owner) < 20) {
                    this.destroy();
                }
            }
        }

        if (this.isRicochet) {
            const barriers = game.entities.filter(e => e.type === 'obstacle' || e.type === 'door');
            for (const o of barriers) {
                if (this.checkCollision(o)) {
                    // Axis detection based on overlap depth
                    const dx = this.x - o.x;
                    const dy = this.y - o.y;
                    const overlapX = (this.width / 2 + o.width / 2) - Math.abs(dx);
                    const overlapY = (this.height / 2 + o.height / 2) - Math.abs(dy);

                    if (overlapX < overlapY) {
                        this.vx *= -1;
                        this.x += (dx > 0 ? overlapX : -overlapX);
                    } else {
                        this.vy *= -1;
                        this.y += (dy > 0 ? overlapY : -overlapY);
                    }

                    this.bounces++;
                    if (this.bounces >= 3) {
                        this.destroy();
                        break;
                    }

                    // Slight jitter and normalize
                    this.vx += (Math.random() - 0.5);
                    this.vy += (Math.random() - 0.5);
                    const mag = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                    this.vx = (this.vx / mag) * CONFIG.BULLET_SPEED;
                    this.vy = (this.vy / mag) * CONFIG.BULLET_SPEED;
                    break; // Only bounce off one thing per frame
                }
            }
        }

        this.updatePosition();
        if (this.x < -20 || this.x > CONFIG.CANVAS_WIDTH + 20 ||
            this.y < -20 || this.y > CONFIG.CANVAS_HEIGHT + 20) {
            this.destroy();
        }
    }

    // New method for handling hits
    hitEntity(entity) {
        if (this.isPiercing) {
            if (entity.type === 'boss' || entity instanceof KeyEnemy) {
                this.destroy();
                return 2;
            }
            return 1;
        } else if (this.isBoomerang) {
            this.destroy();
            if (entity.type === 'boss' || entity instanceof KeyEnemy) {
                return 2;
            }
            return 1;
        } else if (this.isRicochet) {
            if (entity.type === 'enemy' || entity.type === 'boss') {
                this.bounces++;
                if (this.bounces >= 3) {
                    this.destroy();
                } else {
                    // Simple reflection and push-out for enemies
                    this.vx *= -1;
                    this.vy *= -1;
                    this.x += this.vx * 2;
                    this.y += this.vy * 2;
                }
            }
            return 1;
        } else {
            this.destroy();
            return 1;
        }
    }
}

// --- Player ---
class Player extends Entity {
    constructor(id, x, y, controls, maxLives) {
        super(x, y, 24, 24, 'player');
        this.id = id;
        this.controls = controls;
        this.domElement.classList.add(id);

        this.speed = CONFIG.PLAYER_SPEED;
        this.shotsFired = 0;
        this.reloading = false;
        this.fireButtonDown = false; // Track button state for single-fire
        this.health = 1;
        this.lives = maxLives;
        this.maxLives = maxLives;
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

    update(input, game, dtScale) {
        if (this.dead) return;

        let dx = 0, dy = 0;
        if (input[this.controls.up]) dy -= 1;
        if (input[this.controls.down]) dy += 1;
        if (input[this.controls.left]) dx -= 1;
        if (input[this.controls.right]) dx += 1;

        if (dx !== 0 || dy !== 0) {
            const mag = Math.sqrt(dx * dx + dy * dy);
            this.x += (dx / mag) * this.speed * dtScale;
            this.y += (dy / mag) * this.speed * dtScale;
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

        // Trail - frequency already handles its own ticking but we could scale it
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
        } else if (this.attackType === 'boomerang') {
            const vx = Math.cos(this.aimAngle) * CONFIG.BULLET_SPEED;
            const vy = Math.sin(this.aimAngle) * CONFIG.BULLET_SPEED;
            const bullet = new Projectile(this.x, this.y, vx, vy, 'player', this._color, this);
            bullet.isBoomerang = true;
            game.entities.push(bullet);
            game.worldElement.appendChild(bullet.domElement);
        } else if (this.attackType === 'ricochet') {
            const vx = Math.cos(this.aimAngle) * CONFIG.BULLET_SPEED;
            const vy = Math.sin(this.aimAngle) * CONFIG.BULLET_SPEED;
            const bullet = new Projectile(this.x, this.y, vx, vy, 'player', this._color);
            bullet.isRicochet = true;
            game.entities.push(bullet);
            game.worldElement.appendChild(bullet.domElement);
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
        game.showFloatingText('-1', this.x, this.y, '#ff0033');

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

    update(players, game, dtScale) {
        if (!this.active) return;

        this.moveTimer -= dtScale;
        if (this.moveTimer <= 0) {
            const angle = Math.random() * Math.PI * 2;
            this.direction.x = Math.cos(angle);
            this.direction.y = Math.sin(angle);
            this.moveTimer = Utils.randomRange(30, 90);
        }

        this.dashTimer -= dtScale;
        const spd = this.dashTimer > 0 ? this.speed * 2.5 : this.speed;
        if (this.dashTimer <= -90) this.dashTimer = 25;

        const nx = this.x + this.direction.x * spd * dtScale;
        const ny = this.y + this.direction.y * spd * dtScale;

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
        this.shootTimer -= dtScale;
        if (this.shootTimer <= 0) {
            const alivePlayers = players.filter(p => !p.dead);
            if (alivePlayers.length > 0) {
                const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
                const angle = Math.atan2(target.y - this.y, target.x - this.x);
                const bullet = new Projectile(this.x, this.y, Math.cos(angle) * 3, Math.sin(angle) * 3, 'enemy', null);
                game.entities.push(bullet);
                game.worldElement.appendChild(bullet.domElement);
                this.shootTimer = 120 + Math.random() * 60;
            }
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

    update(players, game, dtScale) {
        if (!this.active) return;

        // Circular movement logic
        this.moveAngle += 0.02 * this.circleDir * dtScale;
        const vx = Math.cos(this.moveAngle) * this.speed * dtScale;
        const vy = Math.sin(this.moveAngle) * this.speed * dtScale;

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
        this.shootTimer -= dtScale;
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

// --- Sphere Enemy (Circle, diagonal shooting) ---
class SphereEnemy extends Entity {
    constructor(x, y) {
        super(x, y, 40, 40, 'enemy');
        this.hp = 1;
        this.speed = 1.0;
        this.active = false;
        this.domElement.classList.add('sphere-enemy'); // New class for styling
        this.moveAngle = Math.random() * Math.PI * 2;
        this.shootTimer = 200 + Math.random() * 100;
        this.circleDir = Math.random() > 0.5 ? 1 : -1;
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

    update(players, game, dtScale) {
        if (!this.active) return;

        // Circular movement logic
        this.moveAngle += 0.02 * this.circleDir * dtScale;
        const vx = Math.cos(this.moveAngle) * this.speed * dtScale;
        const vy = Math.sin(this.moveAngle) * this.speed * dtScale;

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

        this.shootTimer -= dtScale;
        if (this.shootTimer <= 0) {
            this.shoot(game);
            this.shootTimer = 200 + Math.random() * 100;
        }

        // Enemy resolution (solid enemies)
        const enemies = game.entities.filter(e => e.type === 'enemy' || e.type === 'boss');
        this._resolveEntities(enemies);

        this.x = Utils.clamp(this.x, 20, CONFIG.CANVAS_WIDTH - 20);
        this.y = Utils.clamp(this.y, 20, CONFIG.CANVAS_HEIGHT - 20);

        // Trail
        this._spawnTrail(game.worldElement, '#cc0022', 4); // Blue trail
        this.updatePosition();
    }

    shoot(game) {
        const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
        angles.forEach(angle => {
            const bullet = new Projectile(this.x, this.y, Math.cos(angle) * 4, Math.sin(angle) * 4, 'enemy', null);
            game.entities.push(bullet);
            game.worldElement.appendChild(bullet.domElement);
        });
    }
}

// --- Key Enemy (Miniboss, Diamond, RGB, 6 hits) ---
class KeyEnemy extends Entity {
    constructor(x, y) {
        super(x, y, 45, 45, 'enemy');
        this.maxHp = 6;
        this.hp = this.maxHp;
        this.speed = 1.5;
        this.active = false;
        this.domElement.classList.add('key-enemy');
        this.moveAngle = Math.random() * Math.PI * 2;
        this.shootTimer = 60;
        this.patternIndex = 0;
        this.circleDir = Math.random() > 0.5 ? 1 : -1;
        this.dirChangeTimer = Utils.randomRange(120, 240);
    }

    activate() {
        this.active = false;
        this.domElement.style.opacity = '0';
    }

    update(players, game, dtScale) {
        if (!this.active) return;

        // Random direction change
        this.dirChangeTimer -= dtScale;
        if (this.dirChangeTimer <= 0) {
            this.circleDir *= -1;
            this.dirChangeTimer = Utils.randomRange(120, 240);
        }

        this.moveAngle += 0.025 * this.circleDir * dtScale;
        this.x += Math.cos(this.moveAngle) * this.speed * dtScale;
        this.y += Math.sin(this.moveAngle) * this.speed * dtScale;

        this.x = Utils.clamp(this.x, 60, CONFIG.CANVAS_WIDTH - 60);
        this.y = Utils.clamp(this.y, 60, CONFIG.CANVAS_HEIGHT - 60);

        this.shootTimer -= dtScale;
        if (this.shootTimer <= 0) {
            // Random choice between cardinal and diagonal
            const useCardinal = Math.random() < 0.5;
            const angles = useCardinal
                ? [0, Math.PI / 2, Math.PI, -Math.PI / 2]
                : [Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4, -Math.PI / 4];

            angles.forEach(angle => {
                const bullet = new Projectile(this.x, this.y, Math.cos(angle) * 5, Math.sin(angle) * 5, 'enemy', null);
                game.entities.push(bullet);
                game.worldElement.appendChild(bullet.domElement);
            });

            this.shootTimer = 90;
        }

        this.updateHealthBar();

        const others = game.entities.filter(e => (e.type === 'enemy' || e.type === 'boss' || e.type === 'obstacle') && e !== this);
        this._resolveEntities(others);
        this._spawnTrail(game.worldElement, '#ffffff', 3);
        this.updatePosition();
    }

    updateHealthBar() {
        const fill = document.getElementById('miniboss-health-fill');
        if (fill) fill.style.width = `${(this.hp / this.maxHp) * 100}%`;
    }

    die(game) {
        if (this.dead) return;
        this.dead = true;
        // Drain health bar to 0
        const fill = document.getElementById('miniboss-health-fill');
        if (fill) fill.style.width = '0%';
        setTimeout(() => {
            document.getElementById('miniboss-health-container').classList.add('hidden');
        }, 400);
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
        this.moveDir = Math.random() > 0.5 ? 1 : -1;
        this.dirChangeTimer = Utils.randomRange(80, 200);
        this.domElement.style.width = '100px';
        this.domElement.style.height = '100px';
    }

    // Refined hitbox — 80% of visual size
    getBounds() {
        return {
            left: this.x - 60,
            right: this.x + 60,
            top: this.y - 60,
            bottom: this.y + 60
        };
    }

    update(players, game, dtScale) {
        if (!this.active) return;

        // Random direction change
        this.dirChangeTimer -= dtScale;
        if (this.dirChangeTimer <= 0) {
            this.moveDir *= -1;
            this.dirChangeTimer = Utils.randomRange(80, 200);
        }

        this.moveTimer -= dtScale;
        if (this.moveTimer <= 0) {
            const cx = CONFIG.CANVAS_WIDTH / 2 - this.x;
            const cy = CONFIG.CANVAS_HEIGHT / 2 - this.y;
            const cd = Math.sqrt(cx * cx + cy * cy);
            const ra = Math.random() * Math.PI * 2;
            const w = Math.min(cd / 150, 1) * 0.4;
            const bx = Math.cos(ra) * (1 - w) + (cx / (cd || 1)) * w;
            const by = Math.sin(ra) * (1 - w) + (cy / (cd || 1)) * w;
            const mag = Math.sqrt(bx * bx + by * by);
            this.moveAngle = Math.atan2(by / mag, bx / mag) * this.moveDir;
            this.moveTimer = Utils.randomRange(40, 100);
        }

        this.x += Math.cos(this.moveAngle) * this.moveSpeed * dtScale;
        this.y += Math.sin(this.moveAngle) * this.moveSpeed * dtScale;
        this.x = Utils.clamp(this.x, 150, CONFIG.CANVAS_WIDTH - 150);
        this.y = Utils.clamp(this.y, 100, CONFIG.CANVAS_HEIGHT - 100);

        this.attackTimer -= dtScale;
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
        super(x, y, 32, 32, 'key');

        const label = document.createElement('div');
        label.className = 'item-label';
        label.innerText = 'KEY';
        label.style.color = '#f8fc00';
        label.style.textShadow = '0 0 5px #f8fc00';
        this.domElement.appendChild(label);
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

        const label = document.createElement('div');
        label.className = 'item-label';
        label.innerText = 'Power up';
        this.domElement.appendChild(label);
    }

    update() {
        this.updatePosition();
    }
}

// --- Life Square ---
class LifeSquare extends Entity {
    constructor(x, y) {
        super(x, y, 30, 30, 'powerup');
        this.domElement.classList.add('life-square-entity');
        this.tick = 0;
    }

    update(game, dtScale) {
        this.tick += dtScale;
        if (Math.floor(this.tick / 30) !== Math.floor((this.tick - dtScale) / 30)) {
            const p1Color = document.getElementById('p1-color-picker').value;
            const p2Color = document.getElementById('p2-color-picker').value;
            const color = Math.floor(this.tick / 30) % 2 === 0 ? p1Color : p2Color;
            this.domElement.style.background = color;
            this.domElement.style.boxShadow = `0 0 15px ${color}`;
        }
        this.updatePosition();
    }
}

// --- Trap ---
class Trap extends Entity {
    constructor(x, y) {
        super(x, y, 30, 30, 'trap');
        this.domElement.classList.add('trap');
    }

    update(dtScale) {
        if (!this.rotation) this.rotation = 0;
        this.rotation = (this.rotation + 5 * dtScale) % 360;
        this.domElement.style.transform = `translate(-50%, -50%) rotate(${this.rotation}deg)`;
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
        this.enemiesSpawned = false;
        this.isEmpty = false;
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

        const normalCoords = roomCoords.filter(c => c[0] !== 0 || c[1] !== 0);

        // Function to pick and remove a coord for special rooms
        const pickRoom = () => {
            const potential = normalCoords.filter(c => (Math.abs(c[0]) + Math.abs(c[1])) > 1);
            if (potential.length > 0) {
                const idx = Math.floor(Math.random() * potential.length);
                const picked = potential[idx];
                const actualIdx = normalCoords.findIndex(c => c[0] === picked[0] && c[1] === picked[1]);
                return normalCoords.splice(actualIdx, 1)[0];
            }
            return normalCoords.length > 0 ? normalCoords.pop() : [0, 0];
        };

        const bossCoord = pickRoom();
        const keyCoord = pickRoom();
        const treasureCoord = pickRoom();
        rooms.get(`${bossCoord[0]},${bossCoord[1]}`).type = 'boss';
        rooms.get(`${keyCoord[0]},${keyCoord[1]}`).type = 'key';
        rooms.get(`${treasureCoord[0]},${treasureCoord[1]}`).type = 'treasure';

        // 1/4 of normal rooms (excluding special ones) should be empty
        const normalRoomCount = normalCoords.length;
        const emptyCount = Math.max(1, Math.floor(normalRoomCount / 4));
        for (let i = 0; i < emptyCount; i++) {
            if (normalCoords.length === 0) break;
            const picked = normalCoords.splice(Math.floor(Math.random() * normalCoords.length), 1)[0];
            rooms.get(`${picked[0]},${picked[1]}`).isEmpty = true;
        }

        // Reachability check — BFS that ensures each special room is reachable
        // WITHOUT passing through another special room as intermediate
        const specialKeys = new Set([
            `${bossCoord[0]},${bossCoord[1]}`,
            `${keyCoord[0]},${keyCoord[1]}`,
            `${treasureCoord[0]},${treasureCoord[1]}`
        ]);
        const canReach = (targetKey) => {
            const visited = new Set(['0,0']);
            const queue = [[0, 0]];
            while (queue.length > 0) {
                const [cx, cy] = queue.shift();
                for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                    const nk = `${cx + dx},${cy + dy}`;
                    if (!rooms.has(nk) || visited.has(nk)) continue;
                    visited.add(nk);
                    if (nk === targetKey) return true;
                    // Don't traverse through OTHER special rooms
                    if (specialKeys.has(nk) && nk !== targetKey) continue;
                    queue.push([cx + dx, cy + dy]);
                }
            }
            return false;
        };
        const allReachable = [...specialKeys].every(k => canReach(k));
        if (!allReachable) return DungeonGenerator.generate(level);

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
        this.difficulty = 'NORMAL';
        this.maxLives = 6;

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
        document.getElementById('btn-single').onclick = () => this.showDifficultyMenu(false);
        document.getElementById('btn-multi').onclick = () => this.showDifficultyMenu(true);
        document.getElementById('btn-difficulty-normal').onclick = () => this.startGame(this.multiplayer, 'NORMAL');
        document.getElementById('btn-difficulty-hard').onclick = () => this.startGame(this.multiplayer, 'HARD');
        document.getElementById('btn-difficulty-back').onclick = () => this.showMainMenu();
        document.getElementById('btn-resume').onclick = () => this.resumeGame();
        document.getElementById('btn-restart').onclick = () => this.doRestart();
        document.getElementById('btn-pause-exit').onclick = () => location.reload();
        document.getElementById('btn-game-over-exit').onclick = () => location.reload();

        document.getElementById('btn-tutorial-main').onclick = () => this.showTutorial();
        document.getElementById('btn-tutorial-pause').onclick = () => this.showTutorial();
        document.getElementById('btn-tutorial-back').onclick = () => this.hideTutorial();

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
        document.getElementById('difficulty-menu').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
    }

    showOptionsMenu() {
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('options-menu').classList.remove('hidden');
    }

    showDifficultyMenu(multi) {
        this.multiplayer = multi;
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('difficulty-menu').classList.remove('hidden');
    }

    startGame(multi, diff) {
        this.multiplayer = multi;
        this.difficulty = diff;
        this.maxLives = diff === 'HARD' ? 3 : 6;
        this.state = 'PLAYING';
        document.getElementById('menu-overlay').classList.add('hidden');
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('difficulty-menu').classList.add('hidden');
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
        document.getElementById('miniboss-health-container').classList.add('hidden');
        this.initDungeon();
        this.showAnnouncement('LEVEL 1');
    }

    refillLives() {
        this.players.forEach(p => {
            p.lives = p.maxLives;
            p.updateLivesUI();
            if (p.dead) p.revive();
        });
    }

    initDungeon() {
        this.rooms = DungeonGenerator.generate(this.level);
        this.currentRoom = this.rooms.get('0,0');
        this.hasKey = false;
        this.spawnPlayers(this.level > 1);
        this.loadRoom();
    }

    spawnPlayers(preservePowerups = false) {
        // Save powerup state before recreating players
        const saved = preservePowerups ? this.players.map(p => ({
            attackType: p.attackType,
            maxShots: p.maxShots
        })) : [];

        this.entities = [];
        this.worldElement.innerHTML = '';

        const p1 = new Player('p1', 400, 300, {
            up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
            shoot: 'Space', altShoot: 'Enter'
        }, this.maxLives);
        const p1Color = document.getElementById('p1-color-picker').value;
        p1.domElement.style.backgroundColor = p1Color;
        p1.domElement.style.boxShadow = `0 0 10px ${p1Color}, 0 0 20px ${p1Color}`;
        p1.setColor(p1Color);
        if (saved[0]) { p1.attackType = saved[0].attackType; p1.maxShots = saved[0].maxShots; }
        p1.updateLivesUI();
        p1._updateAmmoRing();

        this.players = [p1];
        this.entities.push(p1);
        this.worldElement.appendChild(p1.domElement);

        if (this.multiplayer) {
            const p2 = new Player('p2', 450, 300, {
                up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
                shoot: 'CapsLock', altShoot: 'Digit1'
            }, this.maxLives);
            const p2Color = document.getElementById('p2-color-picker').value;
            p2.domElement.style.backgroundColor = p2Color;
            p2.domElement.style.boxShadow = `0 0 10px ${p2Color}, 0 0 20px ${p2Color}`;
            p2.setColor(p2Color);
            if (saved[1]) { p2.attackType = saved[1].attackType; p2.maxShots = saved[1].maxShots; }
            p2.updateLivesUI();
            p2._updateAmmoRing();

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

        // Boss room uses special background
        if (this.currentRoom.type === 'boss') {
            this.worldElement.style.backgroundImage = "url('assets/arena_boss.png')";
        } else {
            this.worldElement.style.backgroundImage = "url('assets/arena.png')";
        }

        this.spawnDoors();
        this.spawnObstacles();
        this.spawnRoomWalls();

        if (!this.currentRoom.cleared) {
            this.spawnLevelEntities();
        } else if (this.currentRoom.type === 'key' && !this.hasKey && this.currentRoom.keySpawnPos) {
            // Re-spawn the key if player left without picking it up
            const kp = this.currentRoom.keySpawnPos;
            const keyItem = new Key(kp.x, kp.y);
            this.entities.push(keyItem);
            this.worldElement.appendChild(keyItem.domElement);
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
        const doorImages = {
            top: 'assets/d_top.png',
            bottom: 'assets/d_bot.png',
            left: 'assets/d_sx.png',
            right: 'assets/d_dx.png'
        };
        const bossDoorImages = {
            top: 'assets/b_top.png',
            bottom: 'assets/b_bot.png',
            left: 'assets/b_sx.png',
            right: 'assets/b_dx.png'
        };

        for (const [dir, active] of Object.entries(this.currentRoom.doors)) {
            if (!active) continue;

            // PNG door layer
            const layer = document.createElement('div');
            layer.classList.add('door-layer');
            const img = (active === 'boss') ? bossDoorImages[dir] : doorImages[dir];
            layer.style.backgroundImage = `url('${img}')`;
            // Aura: green=open, red=locked, rgb=boss
            if (active === 'boss') {
                layer.classList.add('door-aura-rgb');
            } else {
                layer.classList.add('door-aura-green');
            }
            this.worldElement.appendChild(layer);

            // Collision hitbox
            const pos = positions[dir];
            const door = document.createElement('div');
            door.classList.add('door', 'open');
            door.style.left = `${pos.x}px`;
            door.style.top = `${pos.y}px`;
            door.style.width = `${pos.w}px`;
            door.style.height = `${pos.h}px`;
            door.style.transform = 'translate(-50%,-50%)';
            door.dataset.dir = dir;
            if (active === 'boss') door.classList.add('rgb-pulse');
            this.worldElement.appendChild(door);

            // Add as entity for projectile bounces
            const doorEntity = new Entity(pos.x, pos.y, pos.w, pos.h, 'door');
            doorEntity.domElement.style.display = 'none'; // Hidden, DOM element is separate
            this.entities.push(doorEntity);
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
            // Door is 80px wide at x=400. Walls cover 0-360 and 440-800
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
            // Door is 80px high at y=300. Walls cover 0-260 and 340-600
            this._addWall(wallThickness / 2, 130, wallThickness, 260);
            this._addWall(wallThickness / 2, 470, wallThickness, 260);
        }

        // Right wall
        if (!this.currentRoom.doors.right) {
            this._addWall(W - wallThickness / 2, H / 2, wallThickness, H);
        } else {
            // Door is 80px high at y=300. Walls cover 0-260 and 340-600
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

        // Try random spots
        for (let i = 0; i < 100; i++) {
            const rx = Utils.randomRange(100, CONFIG.CANVAS_WIDTH - 100);
            const ry = Utils.randomRange(100, CONFIG.CANVAS_HEIGHT - 100);
            if (!overlaps(rx, ry)) {
                // Also check distance from players for initial spawn
                const tooClose = this.players ? this.players.some(p => Utils.distance({ x: rx, y: ry }, p) < 150) : false;

                // Enlarge safe zone around doors (using center points)
                const doorPos = [{ x: 400, y: 0 }, { x: 400, y: 600 }, { x: 0, y: 300 }, { x: 800, y: 300 }];
                const nearDoor = doorPos.some(d => Utils.distance({ x: rx, y: ry }, d) < 220);

                if (!tooClose && !nearDoor) return { x: rx, y: ry };
            }
        }

        for (const fb of fallbacks) {
            if (!overlaps(fb.x, fb.y)) return fb;
        }
        return { x: cx, y: cy }; // absolute last resort
    }

    spawnLevelEntities() {
        if (this.currentRoom.type === 'normal') {
            const enemyCount = 3 + Math.floor(Math.random() * 2);
            const spawned = [];

            for (let i = 0; i < enemyCount; i++) {
                const safe = this._findSafeSpot(Utils.randomRange(100, 700), Utils.randomRange(100, 500), 40, 40, []);
                const roll = Math.random();
                let enemy;
                if (roll < 0.33) {
                    enemy = new SphereEnemy(safe.x, safe.y);
                } else if (roll < 0.66) {
                    enemy = new Enemy(safe.x, safe.y); // Square
                } else {
                    enemy = new ZombieEnemy(safe.x, safe.y); // Diamond
                }
                this.entities.push(enemy);
                this.worldElement.appendChild(enemy.domElement);
                if (enemy.activate) enemy.activate();
                else {
                    enemy.active = true;
                    enemy.domElement.style.opacity = '1';
                }
                spawned.push(enemy);
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
                const safe = this._findSafeSpot(tx, ty, 30, 30, []);
                const trap = new Trap(safe.x, safe.y);
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

        } else if (this.currentRoom.isEmpty) {
            this.unlockDoors();
            if (Math.random() < 0.20) { // 1/5 chance
                const ls = new LifeSquare(400, 300);
                this.entities.push(ls);
                this.worldElement.appendChild(ls.domElement);
            }
        } else if (this.currentRoom.type === 'key') {
            const safe = this._findSafeSpot(400, 300, 45, 45, [
                { x: 200, y: 150 }, { x: 600, y: 150 }
            ]);
            const keyEnemy = new KeyEnemy(safe.x, safe.y);
            this.entities.push(keyEnemy);
            this.worldElement.appendChild(keyEnemy.domElement);
            // Show bar at 0%, then fill up
            const mbFill = document.getElementById('miniboss-health-fill');
            if (mbFill) mbFill.style.width = '0%';
            document.getElementById('miniboss-health-container').classList.remove('hidden');
            this.lockDoors();

            setTimeout(() => {
                keyEnemy.active = true;
                keyEnemy.domElement.style.opacity = '1';
                keyEnemy.domElement.style.transition = 'opacity 0.5s';
                if (mbFill) mbFill.style.width = '100%';
            }, 1000);
        } else if (this.currentRoom.type === 'boss') {
            const boss = new Boss(400, 300, this.level);
            boss.active = false;
            boss.domElement.style.opacity = '0';
            this.entities.push(boss);
            this.worldElement.appendChild(boss.domElement);
            // Show bar at 0%, then fill up
            const bFill = document.getElementById('boss-health-fill');
            if (bFill) bFill.style.width = '0%';
            document.getElementById('boss-health-container').classList.remove('hidden');
            this.lockDoors();

            setTimeout(() => {
                boss.active = true;
                boss.domElement.style.opacity = '1';
                boss.domElement.style.transition = 'opacity 0.5s';
                if (bFill) bFill.style.width = '100%';
            }, 1000);
        } else if (this.currentRoom.type === 'treasure') {
            if (this.multiplayer) {
                const p1 = new Powerup(300, 300);
                const p2 = new Powerup(500, 300);
                this.entities.push(p1, p2);
                this.worldElement.appendChild(p1.domElement);
                this.worldElement.appendChild(p2.domElement);
            } else {
                const p = new Powerup(400, 300);
                this.entities.push(p);
                this.worldElement.appendChild(p.domElement);
            }
        }
    }

    lockDoors() {
        document.querySelectorAll('.door').forEach(d => {
            d.classList.remove('open');
            d.classList.add('locked');
        });
        // Switch door aura to red
        document.querySelectorAll('.door-layer').forEach(l => {
            l.classList.remove('door-aura-green');
            l.classList.add('door-aura-red');
        });
    }

    unlockDoors() {
        document.querySelectorAll('.door').forEach(d => {
            d.classList.remove('locked');
            d.classList.add('open');
        });
        // Switch door aura to green
        document.querySelectorAll('.door-layer').forEach(l => {
            l.classList.remove('door-aura-red');
            l.classList.add('door-aura-green');
        });
    }

    update(dtScale) {
        if (this.state !== 'PLAYING') return;

        this.entities.forEach(ent => {
            if (ent.type === 'player') ent.update(this.input, this, dtScale);
            else if (ent.type === 'enemy') ent.update(this.players, this, dtScale);
            else if (ent.type === 'projectile') ent.update(this, dtScale);
            else if (ent.type === 'boss' || ent.type === 'key') ent.update(this.players, this, dtScale);
            else if (ent.type === 'trap') ent.update(dtScale);
            else if (ent instanceof LifeSquare) ent.update(this, dtScale);
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
            const [player, trap] = pair;
            if (!player.dead && !player._invincible) {
                this.createDeathParticles(player.x, player.y, 15);
                this.createDeathParticles(trap.x, trap.y, 10); // Explosion effect for trap
                player.die(this);
                trap.destroy();
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
                    if (enemy instanceof KeyEnemy) {
                        enemy.die(this);
                    } else {
                        this.executeEnemyDeath(enemy);
                    }
                    this.score += 100;
                    if (Math.random() < 0.25) {
                        const life = new LifeSquare(enemy.x, enemy.y);
                        this.entities.push(life);
                        this.worldElement.appendChild(life.domElement);
                    }
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
            if (bullet.isPiercing || bullet.isRicochet) {
                // Already handled in Projectile.update for particles and reflection
                return;
            }
            this.createSparkParticles(bullet.x, bullet.y, '#4488aa');
            bullet.destroy();
            return;
        }

        // Player vs Enemy — physical contact damage with cooldown
        pair = getPair('player', 'enemy');
        if (pair) {
            const [player] = pair;
            if (!player.dead && !player._invincible) {
                this.createDeathParticles(player.x, player.y, 10);
                player.die(this);
            }
            return;
        }

        // Player vs Boss — physical contact damage
        pair = getPair('player', 'boss');
        if (pair) {
            const [player] = pair;
            if (!player.dead && !player._invincible) {
                this.createDeathParticles(player.x, player.y, 10);
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
            // Unlock doors in the key room now that key is picked up
            this.unlockDoors();
            this.currentRoom.cleared = true;
            return;
        }

        // Player vs Powerup / LifeSquare
        pair = getPair('player', 'powerup');
        if (pair) {
            const [player, powerup] = pair;
            if (powerup instanceof LifeSquare) {
                if (player.lives < player.maxLives) {
                    player.lives++;
                    player.updateLivesUI();
                    this.showFloatingText('Life Up!', powerup.x, powerup.y);
                    powerup.destroy();
                }
            } else {
                powerup.destroy();
                this.applyRandomPowerup(player);
            }
            return;
        }
    }

    applyRandomPowerup(player) {
        const types = [
            { type: 'shotgun', maxShots: 2, msg: 'SHOTGUN UNLOCKED' },
            { type: 'piercing', maxShots: 3, msg: 'PIERCING UNLOCKED' },
            { type: 'quad', maxShots: 3, msg: 'QUAD UNLOCKED' },
            { type: 'boomerang', maxShots: 3, msg: 'BOOMERANG UNLOCKED' },
            { type: 'ricochet', maxShots: 3, msg: 'RICOCHET UNLOCKED' }
        ];
        // Filter out current type; if attackType is 'normal'/undefined, all 5 are available
        const currentType = player.attackType || 'normal';
        const choices = types.filter(t => t.type !== currentType);
        const pool = choices.length > 0 ? choices : types;
        const picked = pool[Math.floor(Math.random() * pool.length)];
        player.attackType = picked.type;
        player.maxShots = picked.maxShots;
        this.showAnnouncement(picked.msg);
        player.shotsFired = 0;
        player._updateAmmoRing();
    }

    handleDoors() {
        if (!this.currentRoom.cleared) return;
        let nearBossDoor = false;
        this.players.forEach(p => {
            document.querySelectorAll('.door.open').forEach(d => {
                const br = d.getBoundingClientRect();
                const gr = this.worldElement.getBoundingClientRect();
                const dx = br.left - gr.left + br.width / 2;
                const dy = br.top - gr.top + br.height / 2;
                if (Math.abs(p.x - dx) < 40 && Math.abs(p.y - dy) < 40) {
                    if (this.currentRoom.doors[d.dataset.dir] === 'boss' && !this.hasKey) {
                        nearBossDoor = true;
                    }
                    this.changeRoom(d.dataset.dir);
                }
            });
        });
        if (!nearBossDoor) this.hideKeyHint();
    }

    changeRoom(dir) {
        let [x, y] = [this.currentRoom.gridX, this.currentRoom.gridY];
        if (dir === 'top') y--;
        if (dir === 'bottom') y++;
        if (dir === 'left') x--;
        if (dir === 'right') x++;

        const nextRoom = this.rooms.get(`${x},${y}`);
        if (!nextRoom) return;

        if (nextRoom.type === 'boss' && !this.hasKey) {
            this.showKeyHint();
            return;
        }
        this.hideKeyHint();

        // Door transition animation
        const overlay = document.getElementById('level-transition-overlay');
        overlay.classList.remove('hidden');
        overlay.style.opacity = '1';
        this.state = 'TRANSITIONING';

        setTimeout(() => {
            this.currentRoom = nextRoom;
            // Move ALL players (alive or dead/revived) to the door exit position
            const spawnPos = { top: { x: 400, y: 550 }, bottom: { x: 400, y: 50 }, left: { x: 750, y: 300 }, right: { x: 50, y: 300 } };
            const sp = spawnPos[dir];
            this.players.forEach(p => {
                p.x = sp.x;
                p.y = sp.y;
                p.updatePosition();
            });
            this.loadRoom();
            this.state = 'PLAYING';

            setTimeout(() => {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.classList.add('hidden'), 400);
            }, 200);
        }, 300);
    }

    nextLevel() {
        this.level++;
        // Reload all players to max lives
        this.refillLives();
        this.showAnnouncement(`LEVEL ${this.level}`);
        this.initDungeon();
    }

    showKeyHint() {
        const hint = document.getElementById('key-hint-layer');
        if (hint) hint.classList.remove('hidden');
    }

    hideKeyHint() {
        const hint = document.getElementById('key-hint-layer');
        if (hint) hint.classList.add('hidden');
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

    showFloatingText(text, x, y, color = '#39FF14') {
        const el = document.createElement('div');
        el.className = 'floating-text';
        el.innerText = text;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.color = color;
        el.style.textShadow = `0 0 5px ${color}`;
        this.worldElement.appendChild(el);
        setTimeout(() => el.remove(), 1000);
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
        // Boss room stays locked — level transition handles exit
        if (this.currentRoom.type !== 'boss') {
            this.unlockDoors();
        }
        if (this.multiplayer) {
            this.players.forEach(p => {
                if (p.dead && p.lives === 0) {
                    p.lives = 1;
                    p.updateLivesUI();
                    p.revive();
                    // p.x = CONFIG.CANVAS_WIDTH / 2;
                    // p.y = CONFIG.CANVAS_HEIGHT / 2;
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
        // Explosion for 0.5s then spawn key — store position for persistence
        this.currentRoom.keySpawnPos = { x: enemy.x, y: enemy.y };
        this.createDeathParticles(enemy.x, enemy.y, 20);
        setTimeout(() => {
            enemy.destroy();
            const keyItem = new Key(enemy.x, enemy.y);
            this.entities.push(keyItem);
            this.worldElement.appendChild(keyItem.domElement);
        }, 500);
    }

    executeBossDeath(boss) {
        this.state = 'BOSS_DYING';

        // Drain health bar to 0
        const bFill = document.getElementById('boss-health-fill');
        if (bFill) bFill.style.width = '0%';

        // Phase 1: Explosion particles for 1.5s (boss still visible)
        const interval = setInterval(() => {
            this.createDeathParticles(
                boss.x + Utils.randomRange(-50, 50),
                boss.y + Utils.randomRange(-50, 50),
                10
            );
        }, 100);

        setTimeout(() => {
            // Phase 2: Boss destroyed, show announcement ABOVE fade
            clearInterval(interval);
            boss.destroy();
            this.score += 2000;
            document.getElementById('boss-health-container').classList.add('hidden');
            this.showAnnouncement('LEVEL COMPLETED!');

            // Disintegration effect
            for (let i = 0; i < 40; i++) {
                const p = document.createElement('div');
                p.classList.add('particle');
                p.style.width = '10px';
                p.style.height = '10px';
                p.style.borderRadius = '2px';
                p.style.background = 'var(--neon-cyan)';
                p.style.boxShadow = '0 0 10px var(--neon-cyan)';
                p.style.left = `${boss.x + Utils.randomRange(-60, 60)}px`;
                p.style.top = `${boss.y + Utils.randomRange(-60, 60)}px`;
                p.style.setProperty('--tx', `${Utils.randomRange(-30, 30)}px`);
                p.style.setProperty('--ty', `${Utils.randomRange(-400, -800)}px`);
                this.worldElement.appendChild(p);
                setTimeout(() => p.remove(), 1000);
            }

            // Phase 3: Black fade after 0.5s
            setTimeout(() => {
                const overlay = document.getElementById('level-transition-overlay');
                overlay.classList.remove('hidden');
                overlay.style.opacity = '1';

                // Phase 4: Wait 2.5s, then load next level
                setTimeout(() => {
                    this.nextLevel();
                    setTimeout(() => {
                        overlay.style.opacity = '0';
                        setTimeout(() => overlay.classList.add('hidden'), 500);
                        if (this.state === 'BOSS_DYING') this.state = 'PLAYING';
                    }, 800);
                }, 2500);
            }, 500);
        }, 2500); // 1s extra duration as requested (1500 -> 2500)
    }

    executeEnemyDeath(enemy) {
        // Faster and smaller version of boss death
        enemy.active = false;
        const interval = setInterval(() => {
            this.createDeathParticles(
                enemy.x + Utils.randomRange(-15, 15),
                enemy.y + Utils.randomRange(-15, 15),
                4
            );
        }, 50);

        setTimeout(() => {
            clearInterval(interval);
            enemy.destroy();
            // Disintegration effect (smaller)
            for (let i = 0; i < 10; i++) {
                const p = document.createElement('div');
                p.classList.add('particle');
                p.style.width = '4px';
                p.style.height = '4px';
                p.style.background = 'var(--neon-red)';
                p.style.boxShadow = '0 0 5px var(--neon-red)';
                p.style.left = `${enemy.x + Utils.randomRange(-20, 20)}px`;
                p.style.top = `${enemy.y + Utils.randomRange(-20, 20)}px`;
                p.style.setProperty('--tx', `${Utils.randomRange(-15, 15)}px`);
                p.style.setProperty('--ty', `${Utils.randomRange(-100, -200)}px`);
                this.worldElement.appendChild(p);
                setTimeout(() => p.remove(), 500);
            }
        }, 300);
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
        document.getElementById('tutorial-panel').classList.add('hidden');
    }

    showTutorial() {
        // Ensure overlay is visible
        document.getElementById('menu-overlay').classList.remove('hidden');
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('pause-menu').classList.add('hidden');
        document.getElementById('options-menu').classList.add('hidden');
        document.getElementById('tutorial-panel').classList.remove('hidden');
    }

    hideTutorial() {
        document.getElementById('tutorial-panel').classList.add('hidden');
        if (this.state === 'PAUSED') {
            document.getElementById('pause-menu').classList.remove('hidden');
        } else {
            document.getElementById('main-menu').classList.remove('hidden');
        }
    }

    initLoop() {
        let lastTime = performance.now();
        const loop = (now) => {
            const dt = now - lastTime;
            lastTime = now;
            const dtScale = dt / 16.67; // Normalized to 60fps
            this.update(Math.min(dtScale, 2)); // Cap at 2 to prevent huge jumps
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }
}

window.onload = () => { window.game = new GameEngine(); };
