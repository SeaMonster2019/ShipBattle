// ============================================================
//  虚空海战 - Void Combat H5
//  规则还原：行商浪人(Rogue Trader CRPG) 虚空战斗系统
//
//  核心规则：
//  1. 四方格地图，8方向移动（45°为单位）
//  2. 每回合必须用完全部 Speed 格数
//  3. 每走 Manoeuvrability 格才能转向一次（每次45°）
//  4. 可在移动途中任意点开火
//  5. 护盾四方向独立（船头F/左舷P/右舷S/背部D），战斗中不自动恢复
//  6. 技能系统：新航向/急转弯/强化护盾/重启护盾/翘曲波/弱点扫描
// ============================================================

"use strict";

// ── 画布尺寸 ────────────────────────────────────────────────
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const area   = document.getElementById('canvas-area');

function resizeCanvas() {
    canvas.width  = area.clientWidth;
    canvas.height = area.clientHeight;
}
resizeCanvas();
window.addEventListener('resize', () => { resizeCanvas(); renderAll(); });

// ── 相机系统 ────────────────────────────────────────────────
// cam.x/y 是世界坐标系中，视口左上角对应的格像素偏移
// 渲染时 ctx.translate(-cam.x, -cam.y) 即可
const cam = { x: 0, y: 0, targetX: 0, targetY: 0 };

// 世界地图大小（格数）
const WORLD_COLS = 40;
const WORLD_ROWS = 30;

// 更新相机目标：以双船中点为中心
function updateCamera() {
    if (!G.player || !G.enemy) return;
    const midX = (G.player.animX + G.enemy.animX) / 2;
    const midY = (G.player.animY + G.enemy.animY) / 2;
    cam.targetX = midX - canvas.width  / 2;
    cam.targetY = midY - canvas.height / 2;
    // 边界限制
    const maxX = WORLD_COLS * TILE - canvas.width;
    const maxY = WORLD_ROWS * TILE - canvas.height;
    cam.targetX = clamp(cam.targetX, 0, Math.max(0, maxX));
    cam.targetY = clamp(cam.targetY, 0, Math.max(0, maxY));
}

function lerpCamera(dt) {
    cam.x = lerp(cam.x, cam.targetX, Math.min(1, dt * 6));
    cam.y = lerp(cam.y, cam.targetY, Math.min(1, dt * 6));
}

// 屏幕坐标 → 世界像素坐标
function screenToWorld(sx, sy) {
    return { wx: sx + cam.x, wy: sy + cam.y };
}

// ── 常量 ────────────────────────────────────────────────────
const TILE = 52;          // 格子像素大小

// 8方向 (角度 deg → 格子偏移)
// 方向索引 0=右 1=右下 2=下 3=左下 4=左 5=左上 6=上 7=右上
const DIRS = [
    [1, 0],[1, 1],[0, 1],[-1, 1],
    [-1,0],[-1,-1],[0,-1],[1,-1]
];
const DIR_ANGLE = [0, 45, 90, 135, 180, 225, 270, 315]; // 度

// 射击弧：船头炮90°正前 / 侧舷炮90°侧面 / 背部炮270°(除正前45°)
// 以"攻击者方向idx与目标相对方向idx之差"判断是否在弧内
// 船头(Prow): 差值在[-1,0,1]即±1个idx(±45°) → 实际覆盖前90°
// 侧舷(Port/Star): 差值±1以内侧面45°
// 背部(Dorsal): 除正前45°外均可
const ARC = {
    PROW:     [-1,0,1],           // 前±1 idx
    PORT:     [-3,-2,-1,0],       // 左侧: 面朝正左±2
    STARBOARD:[0,1,2,3],          // 右侧
    DORSAL:   [-3,-2,-1,0,1,2,3,4] // 几乎全向（±3 idx + 背后）
};

// ── 颜色 ────────────────────────────────────────────────────
const C = {
    sea:       '#07121f',
    grid:      'rgba(20,55,90,0.35)',
    gridHL:    'rgba(80,180,255,0.12)',
    playerShip:'#2ecc71',
    playerDark:'#1a7a44',
    enemyShip: '#e74c3c',
    enemyDark: '#8e1c12',
    bullet:    '#ffd700',
    explosion: ['#ff6b00','#ffd700','#ff3300','#fff'],
    shield:    { F:'#2ecc71', P:'#3498db', S:'#9b59b6', D:'#f39c12' },
    pathValid: 'rgba(60,220,100,0.55)',
    pathInvalid:'rgba(220,60,60,0.55)',
    pathDot:   'rgba(255,220,80,0.8)',
    fireArc:   { PROW:'rgba(255,220,60,0.13)', PORT:'rgba(52,152,219,0.13)', STARBOARD:'rgba(155,89,182,0.13)', DORSAL:'rgba(243,156,18,0.10)' },
    fireArcBorder:{ PROW:'rgba(255,220,60,0.5)', PORT:'rgba(52,152,219,0.5)', STARBOARD:'rgba(155,89,182,0.5)', DORSAL:'rgba(243,156,18,0.4)' },
    reinforced:'rgba(255,255,255,0.35)',
};

// ── 工具 ────────────────────────────────────────────────────
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function rnd(lo,hi){return lo+Math.random()*(hi-lo);}
function rndInt(lo,hi){return lo+Math.floor(Math.random()*(hi-lo+1));}

// 格坐标 → 像素中心
function g2p(col,row){
    return { x: col*TILE + TILE/2, y: row*TILE + TILE/2 };
}
// 像素 → 格坐标
function p2g(px,py){
    return { col:Math.floor(px/TILE), row:Math.floor(py/TILE) };
}

// 方向索引正规化
function normDir(d){ return ((d%8)+8)%8; }

// 两个格之间的格方向（仅限8向）
function gridDir(fc,fr,tc,tr){
    const dc=tc-fc, dr=tr-fr;
    for(let i=0;i<8;i++) if(DIRS[i][0]===Math.sign(dc) && DIRS[i][1]===Math.sign(dr)) return i;
    return -1;
}

// ── 粒子 ────────────────────────────────────────────────────
class Particle{
    constructor(x,y,vx,vy,life,r,color){
        Object.assign(this,{x,y,vx,vy,life,r,color,maxLife:life});
    }
    update(dt){
        this.x+=this.vx*dt; this.y+=this.vy*dt;
        this.vx*=0.90; this.vy*=0.90;
        this.life-=dt;
    }
    draw(){
        const a=clamp(this.life/this.maxLife,0,1);
        ctx.save(); ctx.globalAlpha=a;
        ctx.fillStyle=this.color;
        ctx.beginPath(); ctx.arc(this.x,this.y,this.r*a,0,Math.PI*2); ctx.fill();
        ctx.restore();
    }
}

// ── 炮弹 ────────────────────────────────────────────────────
class Projectile{
    constructor(sx,sy,tx,ty,color,dmgFn){
        this.x=sx; this.y=sy; this.tx=tx; this.ty=ty;
        this.color=color; this.onHit=dmgFn; this.done=false;
        const d=Math.hypot(tx-sx,ty-sy)||1;
        const spd=480;
        this.vx=(tx-sx)/d*spd; this.vy=(ty-sy)/d*spd;
        this.trail=[];
    }
    update(dt){
        this.trail.push({x:this.x,y:this.y});
        if(this.trail.length>10) this.trail.shift();
        this.x+=this.vx*dt; this.y+=this.vy*dt;
        if(Math.hypot(this.x-this.tx,this.y-this.ty)<8){
            this.done=true; this.onHit();
        }
    }
    draw(){
        for(let i=0;i<this.trail.length;i++){
            const t=i/this.trail.length;
            ctx.save(); ctx.globalAlpha=t*0.5;
            ctx.fillStyle=this.color;
            ctx.beginPath(); ctx.arc(this.trail[i].x,this.trail[i].y,3*t,0,Math.PI*2);
            ctx.fill(); ctx.restore();
        }
        ctx.fillStyle=this.color;
        ctx.shadowColor=this.color; ctx.shadowBlur=8;
        ctx.beginPath(); ctx.arc(this.x,this.y,5,0,Math.PI*2); ctx.fill();
        ctx.shadowBlur=0;
    }
}

// ── 舰船 ────────────────────────────────────────────────────
class Ship{
    constructor(cfg){
        // 格坐标
        this.col = cfg.col; this.row = cfg.row;
        // 当前方向索引 (0=右,2=下,4=左,6=上)
        this.dir = cfg.dir ?? 0;
        this.team = cfg.team; // 'player'|'enemy'
        this.color = cfg.color; this.darkColor = cfg.darkColor;

        // 属性
        this.maxHull  = cfg.hull ?? 100;
        this.hull     = this.maxHull;
        this.armour   = cfg.armour ?? 8;   // 护甲 (穿透护盾后减免)
        this.speed    = cfg.speed ?? 5;     // 每回合移动格数
        this.mano     = cfg.mano ?? 2;      // 每N格才能转一次向

        // 护盾四方向: F=船头 P=左舷 S=右舷 D=背部
        this.maxShield = { F:cfg.shieldF??40, P:cfg.shieldP??50, S:cfg.shieldS??50, D:cfg.shieldD??30 };
        this.shield    = { F:this.maxShield.F, P:this.maxShield.P, S:this.maxShield.S, D:this.maxShield.D };
        this.reinforced= { F:false, P:false, S:false, D:false }; // 强化护盾标记

        // 武器冷却 (回合)
        this.wepCd = { PROW:0, PORT:0, STARBOARD:0, DORSAL:0 };

        // 弱点扫描: 受到额外%伤害
        this.scanBonus = 0; // 百分比额外伤害

        // 动画
        this.animX = this.col*TILE + TILE/2;
        this.animY = this.row*TILE + TILE/2;
        this.shakeT= 0;

        this.alive = true;
    }

    // ── 受击 ────────────────────────────────────────────────
    // fromDir: 攻击来自哪个方向idx（全局方向）
    takeDamage(baseDmg, fromDir){
        // 弱点扫描加成
        let dmg = Math.round(baseDmg * (1 + this.scanBonus/100));
        this.scanBonus = 0;

        // 确定被击中的护盾面：相对于船头方向
        // 船头朝向dir，攻击来自fromDir
        // 相对方向diff = fromDir - this.dir (mod 8)
        const diff = normDir(fromDir - this.dir);
        // diff: 0=正前 2=右侧 4=正后 6=左侧
        let face;
        if(diff<=1 || diff===7)      face='F'; // 正前±1
        else if(diff>=2 && diff<=3)  face='S'; // 右侧
        else if(diff===4 || diff===5)face='D'; // 背部
        else                          face='P'; // 左侧(6,7已被前面截断→左侧只剩5,6→6,5)

        // 更精确的面判断
        if(diff===0||diff===7||diff===1) face='F';
        else if(diff===2||diff===3)      face='S';
        else if(diff===4||diff===5)      face='D';
        else                              face='P'; // diff===6

        const shieldMax = this.maxShield[face];
        let shieldCur   = this.shield[face];

        // 强化护盾：减半伤害
        if(this.reinforced[face]){
            dmg = Math.round(dmg * 0.5);
            this.reinforced[face] = false;
        }

        // 护盾吸收
        const shieldAbs = Math.min(shieldCur, dmg);
        this.shield[face] = Math.max(0, shieldCur - shieldAbs);

        // 剩余穿透护甲→船体
        let penetrate = dmg - shieldAbs;
        const armourBlock = Math.min(penetrate, this.armour);
        penetrate = Math.max(0, penetrate - armourBlock);

        this.hull = Math.max(0, this.hull - penetrate);
        if(this.hull<=0) this.alive=false;

        this.shakeT = 0.35;
        return { face, shieldDmg:shieldAbs, armourBlock, hullDmg:penetrate };
    }

    // 武器冷却递减
    tickCooldowns(){
        for(const k in this.wepCd) this.wepCd[k]=Math.max(0,this.wepCd[k]-1);
    }

    // 像素坐标（带动画插值）
    get px(){ return this.animX + (this.shakeT>0?(Math.random()-.5)*8:0); }
    get py(){ return this.animY + (this.shakeT>0?(Math.random()-.5)*8:0); }

    updateAnim(dt){
        if(this.shakeT>0) this.shakeT-=dt;
        // 平滑插值到目标格
        const tx = this.col*TILE+TILE/2;
        const ty = this.row*TILE+TILE/2;
        this.animX = lerp(this.animX, tx, Math.min(1, dt*12));
        this.animY = lerp(this.animY, ty, Math.min(1, dt*12));
    }

    // ── 绘制 ────────────────────────────────────────────────
    draw(){
        const px=this.px, py=this.py;
        const angleDeg = DIR_ANGLE[this.dir];
        const rad = angleDeg * Math.PI/180;

        ctx.save();
        ctx.translate(px,py);
        ctx.rotate(rad + Math.PI/2); // +90° 使方向idx=6(上)对应视觉"船头朝上"

        const W=14, H=24;

        // 船体
        const g = ctx.createLinearGradient(-W,-H,W,H);
        g.addColorStop(0, this.color);
        g.addColorStop(1, this.darkColor);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0,-H);
        ctx.lineTo(W,-H*0.3);
        ctx.lineTo(W, H*0.4);
        ctx.lineTo(W*0.5,H);
        ctx.lineTo(-W*0.5,H);
        ctx.lineTo(-W,H*0.4);
        ctx.lineTo(-W,-H*0.3);
        ctx.closePath();
        ctx.fill();

        // 边框
        ctx.strokeStyle='rgba(255,255,255,0.25)';
        ctx.lineWidth=1.5; ctx.stroke();

        // 甲板
        ctx.fillStyle='rgba(255,255,255,0.1)';
        ctx.fillRect(-W*0.4,-H*0.1,W*0.8,H*0.4);

        // 桅杆
        ctx.fillStyle='rgba(255,255,255,0.5)';
        ctx.fillRect(-1.5,-H*0.5,3,H*0.7);

        ctx.restore();

        // 护盾弧线（不随船旋转，4方向）
        this.drawShields(px, py);

        // 强化标记圆圈
        this.drawReinforced(px, py);
    }

    drawShields(px,py){
        const rad = (DIR_ANGLE[this.dir])*Math.PI/180;
        // F=正前 P=左舷 S=右舷 D=背部
        const faces = [
            { k:'F', offset:0,         halfArc:Math.PI/4, r:40 },
            { k:'P', offset:-Math.PI/2,halfArc:Math.PI/3, r:44 },
            { k:'S', offset: Math.PI/2,halfArc:Math.PI/3, r:44 },
            { k:'D', offset: Math.PI,  halfArc:Math.PI/4, r:38 },
        ];
        for(const f of faces){
            const sv = this.shield[f.k];
            if(sv<=0) continue;
            const ratio = sv/this.maxShield[f.k];
            const dir = rad + f.offset; // 修正：视觉上船头朝上，+90°
            const visualDir = dir + Math.PI/2;
            ctx.save();
            ctx.globalAlpha = ratio*0.75;
            ctx.strokeStyle = C.shield[f.k];
            ctx.lineWidth = 4;
            ctx.shadowColor = C.shield[f.k];
            ctx.shadowBlur  = 12;
            ctx.beginPath();
            ctx.arc(px, py, f.r, visualDir-f.halfArc, visualDir+f.halfArc);
            ctx.stroke();
            ctx.restore();
        }
    }

    drawReinforced(px,py){
        const rad=(DIR_ANGLE[this.dir])*Math.PI/180;
        const faces=[
            {k:'F',offset:0},{k:'P',offset:-Math.PI/2},
            {k:'S',offset:Math.PI/2},{k:'D',offset:Math.PI}
        ];
        for(const f of faces){
            if(!this.reinforced[f.k]) continue;
            const dir = rad + f.offset + Math.PI/2;
            ctx.save();
            ctx.strokeStyle='#fff';
            ctx.lineWidth=3; ctx.setLineDash([4,4]);
            ctx.globalAlpha=0.9;
            ctx.beginPath();
            ctx.arc(px,py,46, dir-Math.PI/4, dir+Math.PI/4);
            ctx.stroke();
            ctx.restore();
        }
    }
}

function lerp(a,b,t){return a+(b-a)*t;}

// ═══════════════════════════════════════════════════════════
//  游戏状态
// ═══════════════════════════════════════════════════════════
let G = {}; // 全局游戏状态

function startGame(){
    document.getElementById('overlay').style.display='none';

    const COLS = Math.floor(canvas.width/TILE);
    const ROWS = Math.floor(canvas.height/TILE);

    G = {
        cols: COLS, rows: ROWS,
        player: new Ship({
            col:3, row:Math.floor(ROWS/2), dir:0, // 朝右
            team:'player',
            color: C.playerShip, darkColor: C.playerDark,
            hull:120, armour:10, speed:5, mano:2,
            shieldF:40, shieldP:55, shieldS:55, shieldD:30,
        }),
        enemy: new Ship({
            col:COLS-4, row:Math.floor(ROWS/2), dir:4, // 朝左
            team:'enemy',
            color: C.enemyShip, darkColor: C.enemyDark,
            hull:100, armour:8, speed:4, mano:3,
            shieldF:35, shieldP:45, shieldS:45, shieldD:25,
        }),
        projectiles: [],
        particles:   [],

        // 回合状态
        phase: 'player', // 'player' | 'enemy' | 'anim'
        turnNum: 1,

        // 移动规划
        planning: false,
        path: [],         // 已规划的格坐标序列 [{col,row,dir}]
        pathMoveCount: 0, // 累计移动格数
        turnCountInPath:0,// 路径中已用转向次数
        stepsSinceLastTurn:0, // 上次转向后走了多少格

        // 动画队列
        animQueue: [],    // {type:'move'|'fire', ...}
        animTimer: 0,
        animPlaying: false,

        // 技能冷却
        skills: {
            newHeading: 0,  // 新航向：CD=3
            swingRun:   0,  // 急转弯：CD=4
            reinforce:  0,  // 强化护盾：CD=2
            restart:    0,  // 重启护盾：CD=5
            warpWave:   0,  // 翘曲波：CD=4
            scan:       0,  // 弱点扫描：CD=3
        },
        swingRunUsed: false,   // 急转弯本回合是否已用
        newHeadingUsed: false, // 新航向本回合是否已用

        // 待确认的开火列表（移动中途）
        pendingFires:[],

        // 弱点扫描激活
        scanActive: false,

        // 日志
        logs: [],
        waveOffset: 0,
    };

    updateHUD();
    updateSkillBtns();
    setPhase('player');
    addLog('⚓ 战斗开始！规划你的航路并开炮！','#f1c40f');
    addLog(`📐 请点击「规划移动」来规划本回合路径。`,'#8ab0c8');
    requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════════════════════
//  HUD 更新
// ═══════════════════════════════════════════════════════════
function updateHUD(){
    const p=G.player, e=G.enemy;
    setBar('p-hull',  p.hull,       p.maxHull,'bar-hull');
    setBar('p-sf', p.shield.F, p.maxShield.F,'bar-shield-f');
    setBar('p-sp', p.shield.P, p.maxShield.P,'bar-shield-p');
    setBar('p-ss', p.shield.S, p.maxShield.S,'bar-shield-s');
    setBar('p-sd', p.shield.D, p.maxShield.D,'bar-shield-d');
    setBar('e-hull',  e.hull,       e.maxHull,'bar-hull');
    setBar('e-sf', e.shield.F, e.maxShield.F,'bar-shield-f');
    setBar('e-sp', e.shield.P, e.maxShield.P,'bar-shield-p');
    setBar('e-ss', e.shield.S, e.maxShield.S,'bar-shield-s');
    setBar('e-sd', e.shield.D, e.maxShield.D,'bar-shield-d');

    document.getElementById('p-speed').textContent=p.speed;
    document.getElementById('p-mano').textContent=p.mano;
    document.getElementById('e-speed').textContent=e.speed;
    document.getElementById('e-mano').textContent=e.mano;

    const moved = G.path ? G.path.length : 0;
    const left  = G.player.speed - moved;
    document.getElementById('move-left').textContent =
        G.planning ? `${left} 格` : `${G.player.speed} 格`;
    document.getElementById('turn-num').textContent = G.turnNum;
}

function setBar(id, val, max, cls){
    const fill=document.getElementById(id);
    const text=document.getElementById(id+'-t');
    if(!fill||!text)return;
    const pct=clamp(val/max*100,0,100);
    fill.style.width=pct+'%';
    text.textContent=`${Math.ceil(val)}/${max}`;
}

function updateStatusText(){
    const el=document.getElementById('status-text');
    if(G.phase==='player'){
        el.innerHTML='<span class="turn-player">▶ 玩家回合</span>';
    } else if(G.phase==='enemy'){
        el.innerHTML='<span class="turn-enemy">⚙ 敌方行动中...</span>';
    } else {
        el.innerHTML='<span style="color:#f1c40f;">⟳ 动画播放中</span>';
    }
}

function updateSkillBtns(){
    const sk=G.skills;
    const setBtnCd=(id,cdId,cd)=>{
        const btn=document.getElementById(id);
        const cdEl=document.getElementById(cdId);
        btn.disabled = (G.phase!=='player' || cd>0);
        cdEl.textContent = cd>0?`CD:${cd}`:'';
    };
    setBtnCd('sk-newheading','sk-nh-cd',sk.newHeading);
    setBtnCd('sk-swingrun',  'sk-sr-cd',sk.swingRun);
    setBtnCd('sk-reinforce', 'sk-ri-cd',sk.reinforce);
    setBtnCd('sk-restart',   'sk-rs-cd',sk.restart);
    setBtnCd('sk-warpwave',  'sk-ww-cd',sk.warpWave);
    setBtnCd('sk-scan',      'sk-sc-cd',sk.scan);
}

// ═══════════════════════════════════════════════════════════
//  日志
// ═══════════════════════════════════════════════════════════
function addLog(msg, color='#d4e8f0'){
    G.logs.push({msg,color});
    if(G.logs.length>40) G.logs.shift();
    const box=document.getElementById('log-box');
    box.innerHTML=G.logs.slice(-12).map(l=>`<div class="log-line" style="color:${l.color}">${l.msg}</div>`).join('');
    box.scrollTop=box.scrollHeight;
}

// ═══════════════════════════════════════════════════════════
//  相位切换
// ═══════════════════════════════════════════════════════════
function setPhase(ph){
    G.phase=ph;
    updateStatusText();
    const isPlayer = ph==='player';

    // 规划按钮
    document.getElementById('btn-plan').disabled   = !isPlayer || G.planning;
    document.getElementById('btn-end').disabled    = !isPlayer || G.planning;
    document.getElementById('btn-fire-prow').disabled = !isPlayer || G.planning;
    document.getElementById('btn-fire-port').disabled = !isPlayer || G.planning;
    document.getElementById('btn-fire-star').disabled = !isPlayer || G.planning;
    document.getElementById('btn-fire-dors').disabled = !isPlayer || G.planning;

    document.getElementById('btn-confirm').style.display    = G.planning?'':'none';
    document.getElementById('btn-cancel-plan').style.display= G.planning?'':'none';
    document.getElementById('btn-plan').style.display       = G.planning?'none':'';
    document.getElementById('btn-end').style.display        = G.planning?'none':'';
    document.getElementById('move-hint').style.display      = G.planning?'':'none';

    updateSkillBtns();
    updateFireBtns();
}

function updateFireBtns(){
    const isPlayer = G.phase==='player' && !G.planning;
    const p = G.player;
    const canFire = (wep)=> isPlayer && p.wepCd[wep]===0 && checkFiringArc(p, G.enemy, wep);
    document.getElementById('btn-fire-prow').disabled = !canFire('PROW');
    document.getElementById('btn-fire-port').disabled = !canFire('PORT');
    document.getElementById('btn-fire-star').disabled = !canFire('STARBOARD');
    document.getElementById('btn-fire-dors').disabled = !canFire('DORSAL');
}

// ═══════════════════════════════════════════════════════════
//  射击弧判断
// ═══════════════════════════════════════════════════════════
// 判断 target 是否在 shooter 的 wep 武器射程/弧内
function checkFiringArc(shooter, target, wep){
    // 计算 target 相对 shooter 的格方向
    const dc = target.col - shooter.col;
    const dr = target.row - shooter.row;
    if(dc===0 && dr===0) return false;

    // 目标方向角 (像素级，用像素坐标)
    const dx = target.col - shooter.col;
    const dy = target.row - shooter.row;
    const dist = Math.hypot(dx*TILE, dy*TILE);

    // 射程检查
    const ranges = { PROW: TILE*6, PORT: TILE*5, STARBOARD: TILE*5, DORSAL: TILE*4 };
    if(dist > ranges[wep]) return false;

    // 方向差检查（8方向格方向逼近）
    // 用像素角度
    const targetAngleDeg = Math.atan2(dy, dx) * 180/Math.PI; // -180~180
    // 船头视觉角度：dir=0朝右=0°, dir=2朝下=90°, dir=4朝左=180°, dir=6朝上=-90°
    const shipAngleDeg = DIR_ANGLE[shooter.dir]; // 0=右,45=右下...

    // 武器方向（相对于船头）
    const weaponOffsets = { PROW:0, PORT:-90, STARBOARD:90, DORSAL:180 };
    const arcHalfs      = { PROW:45, PORT:60, STARBOARD:60, DORSAL:135 };

    const weaponAngle = shipAngleDeg + weaponOffsets[wep];
    let diff = targetAngleDeg - weaponAngle;
    // 规范化到 -180~180
    while(diff>180)  diff-=360;
    while(diff<-180) diff+=360;

    return Math.abs(diff) <= arcHalfs[wep];
}

// ═══════════════════════════════════════════════════════════
//  移动规划系统
// ═══════════════════════════════════════════════════════════
function startPlanning(){
    if(G.phase!=='player') return;
    G.planning = true;
    G.path = []; // 不含初始位置
    G.stepsSinceLastTurn = 0;
    G.newHeadingUsed = false;
    G.swingRunUsed   = false;
    G.pendingFires   = [];

    // 把当前位置作为起点记录（方向）
    G.planCurDir = G.player.dir;
    G.planCurCol = G.player.col;
    G.planCurRow = G.player.row;

    setPhase('player');
    addLog(`📐 规划路径：必须移动 ${G.player.speed} 格，每走 ${G.player.mano} 格可转向一次`,'#8ab0c8');
    renderAll();
}

function cancelPlanning(){
    G.planning = false;
    G.path = [];
    G.pendingFires = [];
    setPhase('player');
    renderAll();
}

function confirmPlanning(){
    if(!G.planning) return;
    if(G.path.length < G.player.speed){
        addLog(`⚠ 还需移动 ${G.player.speed - G.path.length} 格，必须用完所有移动力！`,'#e87e3d');
        return;
    }
    G.planning = false;
    // 执行路径动画+开火
    executePlan();
}

// 规划中：尝试添加下一格
function tryAddStep(col, row){
    if(!G.planning) return;
    if(G.path.length >= G.player.speed){
        addLog(`⚠ 移动格数已达上限 ${G.player.speed}`,'#e87e3d'); return;
    }

    const curCol = G.planCurCol;
    const curRow = G.planCurRow;
    const curDir = G.planCurDir;

    // 检查目标格是否与当前格相邻（8方向）
    const dc = col - curCol, dr = row - curRow;
    const adx=Math.abs(dc), ady=Math.abs(dr);
    if(adx>1||ady>1||(adx===0&&ady===0)){
        addLog('⚠ 只能移动到相邻格！','#e87e3d'); return;
    }

    // 目标方向
    const newDir = gridDir(curCol,curRow,col,row);
    if(newDir===-1){addLog('⚠ 无效方向','#e87e3d');return;}

    // 边界检查
    if(col<0||col>=G.cols||row<0||row>=G.rows){
        addLog('⚠ 超出边界！','#e87e3d');return;
    }

    // 判断是否需要转向
    const needTurn = newDir !== curDir;
    if(needTurn){
        // 转向检查：上次转向（或出发）后已走了多少格
        if(G.stepsSinceLastTurn < G.player.mano){
            addLog(`⚠ 需再走 ${G.player.mano - G.stepsSinceLastTurn} 格才能转向！`,'#e87e3d');
            return;
        }
        // 只能转45°（相邻方向idx）
        const dirDiff = normDir(newDir - curDir);
        if(dirDiff!==1 && dirDiff!==7){
            addLog('⚠ 每次只能转向45°！','#e87e3d');
            return;
        }
        G.stepsSinceLastTurn = 0;
    }

    // 记录到路径
    G.path.push({col, row, dir:newDir, turned:needTurn});
    G.planCurCol = col;
    G.planCurRow = row;
    G.planCurDir = newDir;
    G.stepsSinceLastTurn++;

    updateHUD();
    renderAll();
}

// ═══════════════════════════════════════════════════════════
//  技能：急转弯（Swing Run）
//  在路径中插入180°大转弯 - 将当前规划方向反转
// ═══════════════════════════════════════════════════════════
function useSwingRun(){
    if(G.skills.swingRun>0||!G.planning||G.swingRunUsed) return;
    // 必须已经移动了至少一格（加速阶段）
    if(G.path.length===0){addLog('⚠ 急转弯须在移动后使用','#e87e3d');return;}

    // 反转方向
    G.planCurDir = normDir(G.planCurDir + 4);
    G.stepsSinceLastTurn = 0; // 重置转向计数
    G.swingRunUsed = true;
    G.skills.swingRun = 4;

    // 在路径中记录急转弯标记
    if(G.path.length>0) G.path[G.path.length-1].swingRun=true;
    addLog('🔄 急转弯！舰船执行180°大转向！','#f39c12');
    updateSkillBtns();
    renderAll();
}

// ═══════════════════════════════════════════════════════════
//  技能：新航向（New Heading）
//  下一次转向可以转90°
// ═══════════════════════════════════════════════════════════
function useNewHeading(){
    if(G.skills.newHeading>0||!G.planning||G.newHeadingUsed) return;
    G.newHeadingUsed = true;
    G.skills.newHeading = 3;
    addLog('🧭 新航向激活！下次转向可转90°！','#3de87e');
    updateSkillBtns();
}

// 在规划中用NewHeading转向
function tryTurnWithNewHeading(targetDir){
    if(!G.planning||!G.newHeadingUsed) return false;
    const curDir = G.planCurDir;
    const diff = normDir(targetDir - curDir);
    // 允许转90°（diff=2或6）
    if(diff!==2 && diff!==6) return false;
    if(G.stepsSinceLastTurn < G.player.mano){
        addLog(`⚠ 新航向：需再走 ${G.player.mano - G.stepsSinceLastTurn} 格`,'#e87e3d');
        return false;
    }
    return true;
}

// ═══════════════════════════════════════════════════════════
//  技能：强化护盾（Reinforce Shields）
// ═══════════════════════════════════════════════════════════
function useReinforce(){
    if(G.skills.reinforce>0||G.phase!=='player'||G.planning) return;
    // 弹出选择框
    const face = promptShieldFace();
    if(!face) return;
    G.player.reinforced[face] = true;
    G.skills.reinforce = 2;
    const names={F:'船头',P:'左舷',S:'右舷',D:'背部'};
    addLog(`🛡 强化 ${names[face]} 护盾：下次受击减半！`,'#3498db');
    updateSkillBtns(); renderAll();
}

function promptShieldFace(){
    const r=prompt('强化哪个护盾？输入: F(船头) / P(左舷) / S(右舷) / D(背部)','F');
    if(!r) return null;
    const v=r.toUpperCase();
    if(['F','P','S','D'].includes(v)) return v;
    addLog('⚠ 无效护盾方向','#e87e3d'); return null;
}

// ═══════════════════════════════════════════════════════════
//  技能：重启护盾（Restart Shields）
//  完全恢复全部护盾，但下回合速度/射程-1
// ═══════════════════════════════════════════════════════════
function useRestartShields(){
    if(G.skills.restart>0||G.phase!=='player'||G.planning) return;
    const p=G.player;
    p.shield.F=p.maxShield.F;
    p.shield.P=p.maxShield.P;
    p.shield.S=p.maxShield.S;
    p.shield.D=p.maxShield.D;
    G.skills.restart=5;
    addLog('🔋 重启护盾！全部护盾满格恢复！(下回合速度-1)','#9b59b6');
    G.restartPenalty=true; // 下回合speed-1
    updateSkillBtns(); updateHUD(); renderAll();
}

// ═══════════════════════════════════════════════════════════
//  技能：翘曲波（Warp Wave）
//  强制敌舰旋转45°
// ═══════════════════════════════════════════════════════════
function useWarpWave(){
    if(G.skills.warpWave>0||G.phase!=='player'||G.planning) return;
    const e=G.enemy;
    const rot=rndInt(0,1)===0?1:7; // 顺时针或逆时针
    e.dir=normDir(e.dir+rot);
    G.skills.warpWave=4;
    // 对受损敌舰造成额外伤害
    const missingHull = e.maxHull - e.hull;
    const extraDmg = Math.round(missingHull*0.15);
    if(extraDmg>0){
        e.hull=Math.max(0,e.hull-extraDmg);
        addLog(`🌀 翘曲波！敌舰被迫旋转45°，额外伤害 ${extraDmg}！`,'#9b59b6');
    } else {
        addLog(`🌀 翘曲波！敌舰被迫旋转45°！`,'#9b59b6');
    }
    if(e.hull<=0){e.alive=false; checkGameOver();}
    G.skills.warpWave=4;
    updateSkillBtns(); updateHUD(); renderAll();
}

// ═══════════════════════════════════════════════════════════
//  技能：弱点扫描（Vulnerability Scan）
//  敌舰下次受击+50%伤害
// ═══════════════════════════════════════════════════════════
function useScan(){
    if(G.skills.scan>0||G.phase!=='player'||G.planning) return;
    G.enemy.scanBonus=50;
    G.skills.scan=3;
    addLog(`🔍 弱点扫描！敌舰下次受击+50%伤害！`,'#f1c40f');
    updateSkillBtns();
}

// ═══════════════════════════════════════════════════════════
//  执行规划路径（动画化）
// ═══════════════════════════════════════════════════════════
function executePlan(){
    setPhase('anim');

    // 构建动画队列
    let curCol=G.player.col, curRow=G.player.row;
    const queue=[];

    for(let i=0;i<G.path.length;i++){
        const step=G.path[i];

        // 急转弯标记
        if(step.swingRun){
            queue.push({type:'swingrun', dir: normDir(step.dir+4)});
        }

        // 移动到该格
        queue.push({type:'move', col:step.col, row:step.row, dir:step.dir});
        curCol=step.col; curRow=step.row;
    }

    // 添加待发射
    for(const pf of G.pendingFires){
        queue.push({type:'fire', wep:pf.wep, afterStep:pf.afterStep});
    }

    // 敌方AI回合
    queue.push({type:'enemyTurn'});

    G.animQueue = queue;
    G.animIdx = 0;
    G.animStepTimer = 0;
    processAnimQueue(0.0);
}

function processAnimQueue(dt){
    if(G.animIdx >= G.animQueue.length){
        // 完成
        setPhase('player');
        G.player.tickCooldowns();
        for(const k in G.skills) if(G.skills[k]>0) G.skills[k]--;
        if(G.restartPenalty){ G.player.speed=Math.max(1,G.player.speed-1); G.restartPenalty=false; }
        updateHUD(); updateSkillBtns(); updateFireBtns();
        addLog(`── 回合 ${G.turnNum} 结束 ── 新回合开始`,'#95a5a6');
        addLog(`📐 请规划新回合的移动路径`,'#8ab0c8');
        return;
    }

    const action = G.animQueue[G.animIdx];

    if(action.done){
        G.animIdx++;
        G.animStepTimer=0;
        processAnimQueue(0);
        return;
    }

    G.animStepTimer += dt;

    switch(action.type){
        case 'move':
            if(G.animStepTimer>=0.12){
                G.player.col=action.col;
                G.player.row=action.row;
                G.player.dir=action.dir;
                spawnWake(G.player.animX, G.player.animY);
                action.done=true;
            }
            break;
        case 'swingrun':
            if(G.animStepTimer>=0.2){
                G.player.dir=action.dir;
                addLog('🔄 急转弯执行！','#f39c12');
                action.done=true;
            }
            break;
        case 'fire':
            if(G.animStepTimer>=0.05){
                doPlayerFire(action.wep);
                action.done=true;
            }
            break;
        case 'enemyTurn':
            if(G.animStepTimer>=0.3){
                runEnemyAI();
                action.done=true;
            }
            break;
    }
}

// ═══════════════════════════════════════════════════════════
//  开火
// ═══════════════════════════════════════════════════════════
function doPlayerFire(wep){
    const p=G.player, e=G.enemy;
    if(p.wepCd[wep]>0){ addLog(`⚠ ${wep} 武器冷却中`,'#e87e3d'); return; }
    if(!checkFiringArc(p,e,wep)){
        addLog(`⚠ 敌舰不在 ${wep} 射击弧内！`,'#e87e3d'); return;
    }

    const dmgTable={PROW:rndInt(14,22), PORT:rndInt(20,32), STARBOARD:rndInt(20,32), DORSAL:rndInt(12,18)};
    const cdTable ={PROW:2, PORT:1, STARBOARD:1, DORSAL:1};
    const dmg=dmgTable[wep];
    p.wepCd[wep]=cdTable[wep];

    // 攻击来自：玩家位置到敌人位置的方向
    const dx=e.col-p.col, dy=e.row-p.row;
    const atAngle=Math.atan2(dy,dx)*180/Math.PI;
    // 转成8方向idx
    let fromDirIdx=Math.round(atAngle/45); // -4~4
    fromDirIdx=normDir(fromDirIdx);

    spawnProjectile(p.animX, p.animY, e.animX, e.animY, C.bullet, ()=>{
        const res=e.takeDamage(dmg, fromDirIdx);
        spawnExplosion(e.animX, e.animY);
        const wnames={PROW:'船头炮',PORT:'左舷炮',STARBOARD:'右舷炮',DORSAL:'背部炮'};
        const fnames={F:'船头面',P:'左舷面',S:'右舷面',D:'背部面'};
        addLog(`💥 ${wnames[wep]} 命中${fnames[res.face]}：盾-${res.shieldDmg} 甲-${res.armourBlock} 体-${res.hullDmg}`,'#3de87e');
        updateHUD();
        checkGameOver();
    });
}

function doEnemyFire(wep, shooter, target){
    if(shooter.wepCd[wep]>0) return false;
    if(!checkFiringArc(shooter,target,wep)) return false;

    const dmgTable={PROW:rndInt(12,18), PORT:rndInt(18,28), STARBOARD:rndInt(18,28), DORSAL:rndInt(10,16)};
    const cdTable ={PROW:2, PORT:1, STARBOARD:1, DORSAL:1};
    const dmg=dmgTable[wep];
    shooter.wepCd[wep]=cdTable[wep];

    const dx=target.col-shooter.col, dy=target.row-shooter.row;
    let fromDirIdx=normDir(Math.round(Math.atan2(dy,dx)*180/Math.PI/45));

    spawnProjectile(shooter.animX, shooter.animY, target.animX, target.animY, '#e85a3d', ()=>{
        const res=target.takeDamage(dmg,fromDirIdx);
        spawnExplosion(target.animX,target.animY);
        const wnames={PROW:'船头炮',PORT:'左舷炮',STARBOARD:'右舷炮',DORSAL:'背部炮'};
        const fnames={F:'船头面',P:'左舷面',S:'右舷面',D:'背部面'};
        addLog(`💥 敌方${wnames[wep]} 命中我方${fnames[res.face]}：盾-${res.shieldDmg} 甲-${res.armourBlock} 体-${res.hullDmg}`,'#e85a3d');
        updateHUD();
        checkGameOver();
    });
    return true;
}

// ═══════════════════════════════════════════════════════════
//  敌方AI
// ═══════════════════════════════════════════════════════════
function runEnemyAI(){
    const e=G.enemy, p=G.player;
    if(!e.alive||!p.alive) return;

    addLog('⚙ 敌方行动中...',  '#e87e3d');

    // AI移动：尝试把侧舷对准玩家
    const dx=p.col-e.col, dy=p.row-e.row;
    const dist=Math.hypot(dx,dy);

    // 目标方向：理想中让右舷/左舷对准玩家
    // 玩家方向
    let targetAngle=Math.atan2(dy,dx)*180/Math.PI;
    let targetDir=normDir(Math.round(targetAngle/45));

    // 理想：侧舷面向玩家 → 船头方向 = 玩家方向 - 90° 或 +90°
    let idealShipDir1=normDir(targetDir-2); // 让右舷朝玩家
    let idealShipDir2=normDir(targetDir+2); // 让左舷朝玩家

    // 选近的
    let d1=normDir(idealShipDir1-e.dir), d2=normDir(idealShipDir2-e.dir);
    if(d1>4) d1=8-d1; if(d2>4) d2=8-d2;
    let idealDir = d1<=d2 ? idealShipDir1 : idealShipDir2;

    // 模拟AI移动
    let curCol=e.col, curRow=e.row, curDir=e.dir;
    let stepsSinceLastTurn=0;

    for(let step=0;step<e.speed;step++){
        // 尝试转向
        const dirDiff=normDir(idealDir-curDir);
        let turned=false;
        if(dirDiff!==0 && stepsSinceLastTurn>=e.mano){
            // 转一格方向
            const turn = (dirDiff<=4)?1:7; // 顺时针还是逆时针
            curDir=normDir(curDir+turn);
            stepsSinceLastTurn=0;
            turned=true;
        }

        // 前进
        const dd=DIRS[curDir];
        const nc=curCol+dd[0], nr=curRow+dd[1];
        // 边界检查
        if(nc>=0&&nc<G.cols&&nr>=0&&nr<G.rows){
            curCol=nc; curRow=nr;
        }
        stepsSinceLastTurn++;

        // 中途能否开火
        const tempShip={col:curCol,row:curRow,dir:curDir,wepCd:e.wepCd};
        // 简化：AI只在最终位置开火
    }

    e.col=curCol; e.row=curRow; e.dir=curDir;
    e.tickCooldowns();

    // AI开火：优先侧舷
    const wepOrder=['PORT','STARBOARD','PROW','DORSAL'];
    let fired=false;
    for(const w of wepOrder){
        if(doEnemyFire(w,e,p)){fired=true; break;}
    }
    if(!fired) addLog('敌方：本回合无法开火','#8ab0c8');

    G.turnNum++;
    // 速度恢复（重启护盾惩罚）
    if(G.restartPenalty){
        G.player.speed=Math.max(1,G.player.speed-1);
        G.restartPenalty=false;
    }
    updateHUD();
}

// ═══════════════════════════════════════════════════════════
//  游戏结束
// ═══════════════════════════════════════════════════════════
function checkGameOver(){
    if(!G.player.alive||!G.enemy.alive){
        setTimeout(()=>{
            const ov=document.getElementById('overlay');
            const ti=document.getElementById('overlay-title');
            ov.style.display='flex';
            if(!G.player.alive){
                ti.textContent='💀 战败 — 你的旗舰沉没了';
                ti.style.color='#e85a3d';
            } else {
                ti.textContent='🏆 胜利 — 敌舰已击沉！';
                ti.style.color='#3de87e';
            }
        }, 1200);
    }
}

// ═══════════════════════════════════════════════════════════
//  粒子 / 特效
// ═══════════════════════════════════════════════════════════
function spawnExplosion(x,y){
    for(let i=0;i<28;i++){
        const a=Math.random()*Math.PI*2;
        const s=rnd(60,220);
        const col=C.explosion[rndInt(0,C.explosion.length-1)];
        G.particles.push(new Particle(x,y,Math.cos(a)*s,Math.sin(a)*s,rnd(0.4,0.9),rnd(2,6),col));
    }
}

function spawnWake(x,y){
    for(let i=0;i<6;i++){
        const a=Math.random()*Math.PI*2;
        G.particles.push(new Particle(x,y,Math.cos(a)*25,Math.sin(a)*25,rnd(0.5,1.0),rnd(2,4),'rgba(180,220,255,0.5)'));
    }
}

function spawnProjectile(sx,sy,tx,ty,col,onHit){
    G.projectiles.push(new Projectile(sx,sy,tx,ty,col,onHit));
}

// ═══════════════════════════════════════════════════════════
//  渲染
// ═══════════════════════════════════════════════════════════
let waveOff=0;

function renderAll(){
    const W=canvas.width, H=canvas.height;
    ctx.clearRect(0,0,W,H);

    // 海面
    ctx.fillStyle=C.sea;
    ctx.fillRect(0,0,W,H);

    // 波浪
    ctx.save();
    ctx.strokeStyle='rgba(255,255,255,0.035)';
    ctx.lineWidth=1.5;
    for(let row=0;row<10;row++){
        ctx.beginPath();
        for(let x=0;x<=W;x+=8){
            const y=(row/10)*H+Math.sin((x+waveOff)*0.025+row*1.1)*7;
            x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
        }
        ctx.stroke();
    }
    ctx.restore();

    // 网格
    ctx.strokeStyle=C.grid;
    ctx.lineWidth=0.5;
    for(let c=0;c<=G.cols;c++){
        ctx.beginPath();ctx.moveTo(c*TILE,0);ctx.lineTo(c*TILE,H);ctx.stroke();
    }
    for(let r=0;r<=G.rows;r++){
        ctx.beginPath();ctx.moveTo(0,r*TILE);ctx.lineTo(W,r*TILE);ctx.stroke();
    }

    // 射击弧显示（非规划时显示）
    if(G.phase==='player'&&!G.planning) drawFireArcs();

    // 规划路径显示
    if(G.planning) drawPlanPath();

    // 粒子
    for(const p of G.particles) p.draw();

    // 炮弹
    for(const p of G.projectiles) p.draw();

    // 船只
    if(G.enemy.alive)  G.enemy.draw();
    if(G.player.alive) G.player.draw();

    // 格坐标标签（debug可选，这里不显示）
}

function drawFireArcs(){
    const p=G.player, e=G.enemy;
    const weps=['PROW','PORT','STARBOARD','DORSAL'];
    for(const wep of weps){
        if(p.wepCd[wep]>0) continue;
        const offsets={PROW:0,PORT:-90,STARBOARD:90,DORSAL:180};
        const halfs={PROW:45,PORT:60,STARBOARD:60,DORSAL:135};
        const ranges={PROW:TILE*6,PORT:TILE*5,STARBOARD:TILE*5,DORSAL:TILE*4};

        const shipDeg=DIR_ANGLE[p.dir];
        const weapDeg=shipDeg+offsets[wep];
        const weapRad=weapDeg*Math.PI/180;
        const halfRad=halfs[wep]*Math.PI/180;
        const range=ranges[wep];

        ctx.save();
        ctx.fillStyle=C.fireArc[wep];
        ctx.strokeStyle=C.fireArcBorder[wep];
        ctx.lineWidth=1;
        ctx.beginPath();
        ctx.moveTo(p.animX,p.animY);
        ctx.arc(p.animX,p.animY,range,weapRad-halfRad,weapRad+halfRad);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
    }
}

function drawPlanPath(){
    // 画已规划格子
    const steps=[{col:G.player.col,row:G.player.row,dir:G.player.dir},...G.path];
    for(let i=1;i<steps.length;i++){
        const s=steps[i];
        const pos=g2p(s.col,s.row);
        ctx.fillStyle=C.pathValid;
        ctx.fillRect(s.col*TILE+2,s.row*TILE+2,TILE-4,TILE-4);

        // 箭头连线
        if(i>0){
            const prev=steps[i-1];
            const p0=g2p(prev.col,prev.row);
            ctx.strokeStyle=C.pathDot;
            ctx.lineWidth=2;
            ctx.setLineDash([4,4]);
            ctx.beginPath();ctx.moveTo(p0.x,p0.y);ctx.lineTo(pos.x,pos.y);ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // 标记当前可转向的格子位置
    const cur=steps[steps.length-1];
    const canTurnNow = G.stepsSinceLastTurn >= G.player.mano;

    // 高亮当前位置
    ctx.strokeStyle= canTurnNow ? '#3de87e':'#f39c12';
    ctx.lineWidth=2.5;
    ctx.strokeRect(cur.col*TILE+1,cur.row*TILE+1,TILE-2,TILE-2);

    // 显示可到达的相邻格
    const remSteps=G.player.speed - G.path.length;
    if(remSteps>0){
        for(let i=0;i<8;i++){
            const nc=cur.col+DIRS[i][0], nr=cur.row+DIRS[i][1];
            if(nc<0||nc>=G.cols||nr<0||nr>=G.rows) continue;
            const newDir=i;
            const needTurn=newDir!==G.planCurDir;
            let ok=true;
            if(needTurn){
                if(G.stepsSinceLastTurn<G.player.mano) ok=false;
                const dd=normDir(newDir-G.planCurDir);
                if(dd!==1&&dd!==7) ok=false; // 只能转45°
            }
            ctx.fillStyle=ok?'rgba(60,220,100,0.18)':'rgba(220,60,60,0.10)';
            ctx.fillRect(nc*TILE+1,nr*TILE+1,TILE-2,TILE-2);
        }
    }

    // 步数文字
    ctx.fillStyle='#f1c40f';
    ctx.font='bold 13px Arial';
    ctx.textAlign='center';
    ctx.fillText(`已走 ${G.path.length}/${G.player.speed} 格`, canvas.width/2, 40);
    if(!canTurnNow){
        ctx.fillStyle='#f39c12';
        ctx.font='12px Arial';
        ctx.fillText(`再走 ${G.player.mano-G.stepsSinceLastTurn} 格可转向`, canvas.width/2, 58);
    }
}

// ═══════════════════════════════════════════════════════════
//  主循环
// ═══════════════════════════════════════════════════════════
let lastTime=0;
function loop(ts){
    const dt=Math.min((ts-lastTime)/1000,0.05);
    lastTime=ts;
    waveOff+=dt*22;

    // 更新动画
    if(G.phase==='anim'){
        processAnimQueue(dt);
    }

    // 更新炮弹
    for(let i=G.projectiles.length-1;i>=0;i--){
        G.projectiles[i].update(dt);
        if(G.projectiles[i].done) G.projectiles.splice(i,1);
    }
    // 更新粒子
    for(let i=G.particles.length-1;i>=0;i--){
        G.particles[i].update(dt);
        if(G.particles[i].life<=0) G.particles.splice(i,1);
    }
    // 更新船只动画
    G.player.updateAnim(dt);
    G.enemy.updateAnim(dt);

    renderAll();
    requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════════════════════
//  画布点击：规划移动
// ═══════════════════════════════════════════════════════════
canvas.addEventListener('click', e=>{
    if(!G.planning) return;
    const rect=canvas.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    const {col,row}=p2g(mx,my);
    tryAddStep(col,row);
});

canvas.addEventListener('contextmenu', e=>{
    e.preventDefault();
    if(G.planning && G.path.length>0){
        // 撤回最后一步
        const last=G.path.pop();
        if(last){
            G.planCurCol=G.path.length>0?G.path[G.path.length-1].col:G.player.col;
            G.planCurRow=G.path.length>0?G.path[G.path.length-1].row:G.player.row;
            G.planCurDir=G.path.length>0?G.path[G.path.length-1].dir:G.player.dir;
            // 重建stepsSinceLastTurn
            rebuildTurnCount();
        }
        updateHUD(); renderAll();
    }
});

function rebuildTurnCount(){
    // 重新计算stepsSinceLastTurn
    G.stepsSinceLastTurn=0;
    let lastTurnIdx=-1;
    for(let i=G.path.length-1;i>=0;i--){
        if(G.path[i].turned){lastTurnIdx=i; break;}
    }
    if(lastTurnIdx<0){
        G.stepsSinceLastTurn=G.path.length;
    } else {
        G.stepsSinceLastTurn=G.path.length-lastTurnIdx;
    }
    G.planCurDir = G.path.length>0 ? G.path[G.path.length-1].dir : G.player.dir;
    G.planCurCol = G.path.length>0 ? G.path[G.path.length-1].col : G.player.col;
    G.planCurRow = G.path.length>0 ? G.path[G.path.length-1].row : G.player.row;
}

// ═══════════════════════════════════════════════════════════
//  键盘控制
// ═══════════════════════════════════════════════════════════
document.addEventListener('keydown', ev=>{
    const k=ev.key;
    // 数字键开火
    if(k==='1') document.getElementById('btn-fire-prow').click();
    if(k==='2') document.getElementById('btn-fire-port').click();
    if(k==='3') document.getElementById('btn-fire-star').click();
    if(k==='4') document.getElementById('btn-fire-dors').click();
    if(k==='Enter'){ ev.preventDefault();
        if(G.planning) confirmPlanning();
        else document.getElementById('btn-end').click();
    }
    if(k==='Escape') cancelPlanning();
    if(k==='p'||k==='P') startPlanning();
});

// ═══════════════════════════════════════════════════════════
//  按钮绑定
// ═══════════════════════════════════════════════════════════
document.getElementById('btn-plan').addEventListener('click', startPlanning);
document.getElementById('btn-confirm').addEventListener('click', confirmPlanning);
document.getElementById('btn-cancel-plan').addEventListener('click', cancelPlanning);

document.getElementById('btn-end').addEventListener('click', ()=>{
    if(G.phase!=='player'||G.planning) return;
    // 强制结束（未规划移动时，执行原地不动然后AI回合）
    if(G.path.length===0){
        if(!confirm('本回合不移动？（注意：游戏规则要求必须移动）')) return;
    }
    G.planning=false;
    executePlan();
});

document.getElementById('btn-fire-prow').addEventListener('click',()=>{ if(G.phase==='player'&&!G.planning) doPlayerFire('PROW'); updateFireBtns(); });
document.getElementById('btn-fire-port').addEventListener('click',()=>{ if(G.phase==='player'&&!G.planning) doPlayerFire('PORT'); updateFireBtns(); });
document.getElementById('btn-fire-star').addEventListener('click',()=>{ if(G.phase==='player'&&!G.planning) doPlayerFire('STARBOARD'); updateFireBtns(); });
document.getElementById('btn-fire-dors').addEventListener('click',()=>{ if(G.phase==='player'&&!G.planning) doPlayerFire('DORSAL'); updateFireBtns(); });

// 技能按钮
document.getElementById('sk-newheading').addEventListener('click', useNewHeading);
document.getElementById('sk-swingrun').addEventListener('click', ()=>{
    if(!G.planning){addLog('⚠ 急转弯须在移动规划中使用','#e87e3d');return;}
    useSwingRun();
});
document.getElementById('sk-reinforce').addEventListener('click', useReinforce);
document.getElementById('sk-restart').addEventListener('click', useRestartShields);
document.getElementById('sk-warpwave').addEventListener('click', useWarpWave);
document.getElementById('sk-scan').addEventListener('click', useScan);

// ═══════════════════════════════════════════════════════════
//  启动
// ═══════════════════════════════════════════════════════════
startGame();
