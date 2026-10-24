const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const MAP_DIAMETER = 6700;
const WORLD_RADIUS = MAP_DIAMETER / 2;
const WORLD_CENTER = WORLD_RADIUS;
const INITIAL_MASS = 10;
const MAX_MASS = 5000;
const BASE_SPEED = 216;
const BOOST_SPEED = 345;
const FOOD_UNIT = 2.2;
const STEP = 1 / 60;
const MAX_FOODS = 1800;
const TOKEN_BUGS = 80;
const TOKEN_PHONES = 40;

let snakes = {};
let foods = [];
let bugTokens = [];
let phoneTokens = [];

function spawnRandomInCircle(padding = 300) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * (WORLD_RADIUS - padding);
    return {
        x: WORLD_CENTER + Math.cos(angle) * r,
        y: WORLD_CENTER + Math.sin(angle) * r
    };
}

for (let i = 0; i < 1000; i++) {
    const pos = spawnRandomInCircle(200);
    foods.push({ id: Math.random().toString(), x: pos.x, y: pos.y, value: Math.floor(Math.random() * 5) + 1 });
}
for (let i = 0; i < TOKEN_BUGS; i++) {
    const pos = spawnRandomInCircle(200);
    bugTokens.push({ id: Math.random().toString(), x: pos.x, y: pos.y });
}
for (let i = 0; i < TOKEN_PHONES; i++) {
    const pos = spawnRandomInCircle(200);
    phoneTokens.push({ id: Math.random().toString(), x: pos.x, y: pos.y });
}

class ServerSnake {
    constructor(id, name, skinColor) {
        this.id = id;
        this.name = name;
        this.skinColor = skinColor;
        const pos = spawnRandomInCircle(800);
        this.x = pos.x;
        this.y = pos.y;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.mass = INITIAL_MASS;
        this.isBoosting = false;
        this.isDead = false;
        this.spawnShield = 3.0; // 3 секунды неуязвимости при спавне
        this.boostAcc = 0;

        this.segments = [];
        const sp = this.spacing;
        for (let i = 0; i < 15; i++) {
            this.segments.push({ x: this.x - Math.cos(this.angle) * sp * i, y: this.y - Math.sin(this.angle) * sp * i });
        }
    }

    get radius() { return Math.min(48, 12 + Math.sqrt(this.mass) * 0.42); }
    get spacing() { return this.radius * 0.7; }
    get targetLengthPx() { return 80 + Math.pow(this.mass, 0.65) * 10; }
    get targetSegments() { return Math.max(6, Math.round(this.targetLengthPx / this.spacing)); }

    update(dt) {
        if (this.isDead) return;
        if (this.spawnShield > 0) this.spawnShield -= dt;

        let speed = BASE_SPEED;
        if (this.isBoosting && this.mass > 15) {
            speed = BOOST_SPEED;
            this.mass = Math.max(15, this.mass - 8 * dt);
            
            // Оставляем частицы еды с хвоста при ускорении
            this.boostAcc += 8 * dt;
            while (this.boostAcc >= FOOD_UNIT && foods.length < MAX_FOODS) {
                const tail = this.segments[this.segments.length - 1];
                if (tail) {
                    foods.push({
                        id: Math.random().toString(),
                        x: tail.x + (Math.random() - 0.5) * 10,
                        y: tail.y + (Math.random() - 0.5) * 10,
                        value: 1
                    });
                }
                this.boostAcc -= FOOD_UNIT;
            }
        } else {
            this.boostAcc = 0;
        }

        let angleDiff = this.targetAngle - this.angle;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        this.angle += Math.max(-0.12, Math.min(0.12, angleDiff));

        this.x += Math.cos(this.angle) * speed * dt;
        this.y += Math.sin(this.angle) * speed * dt;

        const segs = this.segments;
        segs[0] = { x: this.x, y: this.y };
        const sp = this.spacing;
        for (let i = 1; i < segs.length; i++) {
            const prev = segs[i - 1];
            const cur = segs[i];
            const dx = cur.x - prev.x;
            const dy = cur.y - prev.y;
            const d = Math.hypot(dx, dy) || 0.0001;
            cur.x = prev.x + (dx / d) * sp;
            cur.y = prev.y + (dy / d) * sp;
        }

        const target = this.targetSegments;
        if (segs.length < target) {
            const last = segs[segs.length - 1];
            segs.push({ x: last.x, y: last.y });
        } else if (segs.length > target) {
            segs.pop();
        }

        const distFromCenter = Math.hypot(this.x - WORLD_CENTER, this.y - WORLD_CENTER);
        if (distFromCenter >= WORLD_RADIUS - this.radius && this.spawnShield <= 0) {
            this.isDead = true;
        }
    }
}

io.on('connection', (socket) => {
    console.log(`Игрок подключился: ${socket.id}`);

    socket.on('joinGame', (data) => {
        snakes[socket.id] = new ServerSnake(socket.id, data.name || 'Игрок', data.skinColor || '#4ADE80');
    });

    socket.on('playerInput', (data) => {
        const snake = snakes[socket.id];
        if (snake && !snake.isDead) {
            snake.targetAngle = data.angle;
            snake.isBoosting = !!data.isBoosting;
        }
    });

    socket.on('disconnect', () => {
        console.log(`Игрок отключился: ${socket.id}`);
        delete snakes[socket.id];
    });
});

setInterval(() => {
    for (let id in snakes) {
        const s = snakes[id];
        s.update(STEP);

        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            if (Math.hypot(s.x - f.x, s.y - f.y) < s.radius + 6) {
                s.mass += f.value * FOOD_UNIT;
                foods.splice(i, 1);
                const pos = spawnRandomInCircle(200);
                foods.push({ id: Math.random().toString(), x: pos.x, y: pos.y, value: Math.floor(Math.random() * 5) + 1 });
            }
        }

        for (let i = bugTokens.length - 1; i >= 0; i--) {
            const t = bugTokens[i];
            if (Math.hypot(s.x - t.x, s.y - t.y) < s.radius + 16) {
                bugTokens.splice(i, 1);
                io.to(id).emit('collectToken', { type: 'bug' });
                const pos = spawnRandomInCircle(200);
                bugTokens.push({ id: Math.random().toString(), x: pos.x, y: pos.y });
            }
        }

        for (let i = phoneTokens.length - 1; i >= 0; i--) {
            const t = phoneTokens[i];
            if (Math.hypot(s.x - t.x, s.y - t.y) < s.radius + 16) {
                phoneTokens.splice(i, 1);
                io.to(id).emit('collectToken', { type: 'phone' });
                const pos = spawnRandomInCircle(200);
                phoneTokens.push({ id: Math.random().toString(), x: pos.x, y: pos.y });
            }
        }
    }

    const snakeList = Object.values(snakes).filter(s => !s.isDead);
    for (let s1 of snakeList) {
        if (s1.spawnShield > 0) continue; // Защита от столкновений во время щита
        for (let s2 of snakeList) {
            if (s1 === s2 || s2.spawnShield > 0) continue;
            for (let seg of s2.segments) {
                if (Math.hypot(s1.x - seg.x, s1.y - seg.y) < s1.radius * 0.8) {
                    s1.isDead = true;
                    for (let p of s1.segments) {
                        foods.push({ id: Math.random().toString(), x: p.x, y: p.y, value: 3 });
                    }
                    break;
                }
            }
        }
    }

    for (let id in snakes) {
        if (snakes[id].isDead) delete snakes[id];
    }

    io.emit('gameState', {
        snakes: Object.values(snakes).map(s => ({
            id: s.id,
            name: s.name,
            x: s.x,
            y: s.y,
            angle: s.angle,
            mass: s.mass,
            radius: s.radius,
            skinColor: s.skinColor,
            segments: s.segments,
            spawnShield: s.spawnShield
        })),
        foods: foods,
        bugs: bugTokens,
        phones: phoneTokens
    });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сетевой игровой сервер запущен на http://localhost:${PORT}`);
});