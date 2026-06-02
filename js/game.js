class MainScene extends Phaser.Scene {
  constructor() { super('MainScene'); }

  preload() {
    this.load.json('tileset_tsj', 'sprites/tileset.tsj');
    this.load.image('tiles', 'sprites/tileset.png');

    // character spritesheet and annotation
    this.load.image('character_img', 'sprites/character/character.png');
    this.load.json('character_annot', 'sprites/character/character_annotation.json');

    // enemy spritesheet and annotation
    this.load.image('alienbot_img', 'sprites/enemy/alienbot.png');
    this.load.json('alienbot_annot', 'sprites/enemy/alienbot_annotation.json');
    this.load.image('blue_alienbot_img', 'sprites/enemy/blue_alienrobot.png');
    this.load.json('blue_alienbot_annot', 'sprites/enemy/blue_alienrobot_annotation.json');

    // music
    this.load.audio('bgm', 'music/Rooftop Dash Paris.mp3');

    // sound effects
    this.load.audio('sfx_jump', 'sounds/jump.mp3');
    this.load.audio('sfx_shot', 'sounds/shot.mp3');
    this.load.audio('sfx_enemy_destroyed', 'sounds/enemy destroyed.ogg');
    this.load.audio('sfx_hit', 'sounds/touched by enemy.ogg');

    // HUD
    this.load.image('hud_img', 'sprites/hud/hud.png');
    this.load.json('hud_annot', 'sprites/hud/hud_annotations.json');
  }

  create() {
    (async () => {
      let mapData = null;
      // prefer embedded TMJ if present
      try {
        const r = await fetch('sprites/map1_embedded.tmj');
        if (r.ok) mapData = await r.json();
      } catch (e) {
        mapData = null;
      }
      if (!mapData) {
        // fallback to original TMJ and merge external tileset if referenced
        const r2 = await fetch('sprites/map1.tmj');
        mapData = await r2.json();
        if (mapData && mapData.tilesets && mapData.tilesets.length && mapData.tilesets[0].source) {
          const tsj = this.cache.json.get('tileset_tsj');
          if (tsj) {
            mapData.tilesets[0] = Object.assign({ firstgid: mapData.tilesets[0].firstgid, source: mapData.tilesets[0].source }, tsj);
          } else {
            // try fetch tileset.tsj directly
            try {
              const rt = await fetch('sprites/tileset.tsj');
              if (rt.ok) {
                const tsj2 = await rt.json();
                mapData.tilesets[0] = Object.assign({ firstgid: mapData.tilesets[0].firstgid, source: mapData.tilesets[0].source }, tsj2);
              }
            } catch (e) {}
          }
        }
      }

      // add merged map data into cache so Phaser can create the Tilemap
      // If the map is infinite (uses chunks), convert it to a non-infinite format Phaser handles better
      let mapToUse = mapData;
      if (mapData && mapData.infinite) {
        try {
          mapToUse = convertInfiniteToFinite(mapData);
          console.log('Converted infinite map to finite:', { width: mapToUse.width, height: mapToUse.height });
        } catch (e) {
          console.error('Failed to convert infinite map:', e);
          mapToUse = mapData;
        }
      }

      // manual layer creation (bypasses Phaser's native tilemap which doesn't handle
      // two tilesets sharing the same image in infinite maps)
      const created = {};
      const mapWidth = mapToUse.width;
      const mapHeight = mapToUse.height;
      const tw = mapToUse.tilewidth || 32;
      const th = mapToUse.tileheight || 32;
      const tilesetMeta = (mapToUse.tilesets && mapToUse.tilesets[0]) || {};
      const tilesetName = tilesetMeta.name || 'tileset';
      const margin = typeof tilesetMeta.margin === 'number' ? tilesetMeta.margin : 0;
      const spacing = typeof tilesetMeta.spacing === 'number' ? tilesetMeta.spacing : 0;

      // Build sorted tileset list (descending by firstgid) for GID lookup
      const tsList = (mapToUse.tilesets || []).slice().sort((a, b) => b.firstgid - a.firstgid);

      // Scan ALL layers for a tile whose GID maps to character_spawn_point local ID (1089)
      let spawnPos = null;
      const spawnTileLocalId = 1089;
      console.log('Spawn scan: map size', mapWidth, 'x', mapHeight, 'tilesets:', (mapToUse.tilesets || []).map(t => ({ firstgid: t.firstgid, name: t.name })));
      if (mapToUse && mapToUse.layers) {
        for (const lyr of mapToUse.layers) {
          if (!lyr.data) { console.log('Skipping layer', lyr.name, '(no data)'); continue; }
          console.log('Scanning layer', lyr.name, 'dataLen:', lyr.data.length, 'sample:', lyr.data.slice(0, 16));
          for (let i = 0; i < lyr.data.length; i++) {
            const gid = lyr.data[i];
            if (gid > 0) {
              let localId = -1;
              for (const ts of tsList) {
                if (gid >= ts.firstgid) { localId = gid - ts.firstgid; break; }
              }
              if (localId === spawnTileLocalId) {
                const col = i % mapWidth;
                const row = Math.floor(i / mapWidth);
                spawnPos = { x: col * tw + tw / 2, y: row * th };
                console.log('Found spawn point in layer', lyr.name, 'col', col, 'row', row, 'gid', gid, 'localId', localId, 'spawnPos', spawnPos);
                break;
              }
            }
          }
          if (spawnPos) break;
        }
        if (!spawnPos) console.log('No character_spawn_point tile (id=1089) found in any layer');
      }
      // Also dump all unique local IDs from the Character spawn point layer if it exists
      const spawnLayerDump = (mapToUse.layers || []).find(l => l.name === 'Character spawn point' || l.name === 'character spawn point');
      if (spawnLayerDump && spawnLayerDump.data) {
        const uniqueLocalIds = new Set();
        for (const gid of spawnLayerDump.data) {
          if (gid > 0) {
            let localId = -1;
            for (const ts of tsList) { if (gid >= ts.firstgid) { localId = gid - ts.firstgid; break; } }
            uniqueLocalIds.add(localId);
          }
        }
        console.log('Unique local IDs in Character spawn point layer:', [...uniqueLocalIds]);
      }

      const createLayerFromName = (name, x=0, y=0) => {
        const layerObj = (mapToUse.layers || []).find(l => l.name === name);
        if (!layerObj || !layerObj.data) return null;
        const arr2d = [];
        for (let row = 0; row < mapHeight; row++) {
          const rowArr = [];
          const slice = layerObj.data.slice(row * mapWidth, (row + 1) * mapWidth);
          for (let i = 0; i < slice.length; i++) {
            const gid = slice[i] || 0;
            if (gid === 0) {
              rowArr[i] = -1;
            } else {
              let localId = -1;
              for (const ts of tsList) {
                if (gid >= ts.firstgid) {
                  localId = gid - ts.firstgid;
                  break;
                }
              }
              rowArr[i] = localId;
            }
          }
          arr2d[row] = rowArr;
        }
        console.log('createLayerFromName', name, 'mapWidth', mapWidth, 'mapHeight', mapHeight);
        const tmpMap = this.make.tilemap({ data: arr2d, tileWidth: tw, tileHeight: th });
        const ts = tmpMap.addTilesetImage(tilesetName, 'tiles', tw, th, margin, spacing);
        const layer = tmpMap.createLayer(0, ts, x, y);
        // Apply parallax from Tiled layer data
        if (layerObj.parallaxx !== undefined || layerObj.parallaxy !== undefined) {
          layer.setScrollFactor(
            layerObj.parallaxx !== undefined ? layerObj.parallaxx : 1,
            layerObj.parallaxy !== undefined ? layerObj.parallaxy : 1
          );
        }
        console.log('created layer', name, 'layer size:', layer.layer.width, layer.layer.height);
        created[name] = { tmpMap, layer };
        return layer;
      };

      const fakeMap = {
        createLayer: (name, tileset, x, y) => createLayerFromName(name, x, y),
        getLayer: (name) => created[name] ? { tilemapLayer: created[name].layer } : null,
        widthInPixels: (mapToUse.width || 0) * (mapToUse.tilewidth || 32),
        heightInPixels: (mapToUse.height || 0) * (mapToUse.tileheight || 32),
        mapData: mapToUse,
        layerNames: (mapToUse.layers || []).map(l => l.name),
        firstgid: 0,
        spawnPos: spawnPos,
      };

      setupMapAndPlayer.call(this, fakeMap, null);

      // play background music
      if (this.cache.audio.exists('bgm')) {
        this.sound.play('bgm', { loop: true, volume: 0.5 });
      }

      // mobile on-screen controls
      this._touchLeft = false;
      this._touchRight = false;
      this._touchJump = false;
      this._touchJustJump = false;
      this._jumpBuffer = 0;
      this._jumpWasDown = false;
      const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
      if (isMobile) this._setupMobileControls();
    })();
    // end async IIFE
    return;

    // (map and player setup moved to async branch)
  }

  update() {
    if (!this.player || !this.cursors || !this.keys) return;
    this._onSlope = false;

    const speedMult = (this.keys.SHIFT && this.keys.SHIFT.isDown) ? 1.6 : 1;
    const currentSpeed = this.speed * speedMult;

    const left = this.cursors.left.isDown || this.keys.A.isDown || this._touchLeft;
    const right = this.cursors.right.isDown || this.keys.D.isDown || this._touchRight;

    // jump input with multi-frame buffer (mitigates keyboard ghosting)
    const jumpJustDown = ((this.cursors && this.cursors.up && Phaser.Input.Keyboard.JustDown(this.cursors.up))
      || (this.keys && this.keys.W && Phaser.Input.Keyboard.JustDown(this.keys.W))
      || (this.keys && this.keys.SPACE && Phaser.Input.Keyboard.JustDown(this.keys.SPACE))
      || this._touchJustJump);
    this._touchJustJump = false;
    const jumpDown = this.cursors.up.isDown || this.keys.W.isDown || this.keys.SPACE.isDown;
    if (jumpJustDown || (jumpDown && !this._jumpWasDown)) this._jumpBuffer = 6;
    this._jumpWasDown = jumpDown;
    const jumpPressed = this._jumpBuffer > 0;
    if (this._jumpBuffer > 0) this._jumpBuffer--;

    this.applySlopeAdjustment();

    // Register once per scene: after physics, snap body to ground if close
    if (!this._postRegistered) {
      this._postRegistered = true;
      this.events.on('postupdate', () => {
        if (!this.player || !this.player.body || this._onSlope) return;
        const body = this.player.body;
        const bBot = body.y + body.height;
        const groundTileTop = Math.floor(bBot / 32) * 32;
        const diff = bBot - groundTileTop;
        if (diff > 1 && diff < 10 && body.velocity.y >= 0) {
          body.y = groundTileTop - body.height;
          this.player.y = body.y + this.player.displayOriginY * Math.abs(this.player.scaleY) - body.offset.y * Math.abs(this.player.scaleY);
        }
      });
    }

    const onFloor = this.player.body.blocked.down || this._onSlope;
    if (this._offGroundCount == null) this._offGroundCount = 999;
    if (onFloor) {
      this._offGroundCount = 0;
    } else {
      this._offGroundCount++;
    }
    const stableGrounded = onFloor || this._offGroundCount < 3;

    // reset jumps when grounded
    if (onFloor) this._jumpsUsed = 0;

    // Slope sliding: when idle on a slope, slide down
    if (this._onSlope && !left && !right && this._slopeType) {
      const slideSpeed = 80;
      if (this._slopeType === 'diagonal_bottom_left_to_top_right') {
        this.player.body.velocity.x = -slideSpeed;
      } else if (this._slopeType === 'diagonal_rop_left_to_bottom_right') {
        this.player.body.velocity.x = slideSpeed;
      }
    }

    // Shooting
    const shootPressed = (this.keys.CTRL && Phaser.Input.Keyboard.JustDown(this.keys.CTRL)) || (this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) || this._touchJustShoot;
    this._touchJustShoot = false;
    if (shootPressed) {
      this._playAnim('shoot');
      this.shootBullet();
      this._shootUntil = this.time.now + 600;
      if (!this._shootEventRegistered) {
        this._shootEventRegistered = true;
        this.player.on('animationcomplete', (anim) => {
          if (anim.key === 'shoot') this._shootUntil = 0;
        });
      }
    }

    const isShooting = this._shootUntil > this.time.now;

    // Always apply movement, even during shooting
    let moveX = 0;
    if (left) moveX = -1;
    else if (right) moveX = 1;
    if ((moveX < 0 && this.player.body.blocked.left) || (moveX > 0 && this.player.body.blocked.right)) {
      moveX = 0;
    }
    if (moveX !== 0) {
      this.player.setVelocityX(moveX * currentSpeed);
      this.player.flipX = moveX < 0;
    } else if (!this._onSlope) {
      this.player.setVelocityX(0);
    }

    // Only change animation when not shooting
    if (!isShooting) {
      if (left || right) {
        if (stableGrounded) this._playAnim('walk');
      } else {
        if (stableGrounded) this._playAnim('idle');
      }
      if (!stableGrounded) {
        if (this.player.body.velocity.y < 0) {
          this._playAnim('jump_up');
        } else {
          this._playAnim('jump_down');
        }
      }
    }

    if ((jumpPressed && stableGrounded) || (jumpPressed && this._jumpsUsed < 2)) {
      this.player.setVelocityY(-this.jumpSpeed);
      this._jumpsUsed++;
      this._jumpBuffer = 0;
      if (this.cache.audio.exists('sfx_jump')) this.sound.play('sfx_jump');
    }

    // bullet-enemy collision
    if (this._bullets && this.enemies) {
      for (let bi = this._bullets.length - 1; bi >= 0; bi--) {
        const bullet = this._bullets[bi];
        if (!bullet.active) continue;
        for (const enemy of this.enemies) {
          if (!enemy.active || enemy._isDead) continue;
          if (Phaser.Geom.Intersects.RectangleToRectangle(bullet.getBounds(), enemy.getBounds())) {
            bullet.destroy();
            this._bullets.splice(bi, 1);
            enemy.hp--;
            if (enemy.hp <= 0) {
              enemy._isDead = true;
              enemy.body.setVelocity(0, 0);
              enemy.body.setAllowGravity(false);
              if (this.cache.audio.exists('sfx_enemy_destroyed')) this.sound.play('sfx_enemy_destroyed');
            }
            const explodeKey = enemy._isBlue ? 'blue_alien_exploding' : 'alien_exploding';
            if (this.anims.exists(explodeKey)) enemy.play(explodeKey);
            break;
          }
        }
      }
      this._bullets = this._bullets.filter(b => b.active);
    }

    // enemy patrol
    if (this.enemies) {
      for (const enemy of this.enemies) {
        if (!enemy.active || enemy._isDead) continue;

        // blue alien chase
        if (enemy._isBlue && this.player) {
          const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
          if (dist < 800) {
            const alienRow = Math.floor((enemy.body.y + enemy.body.height) / 32);
            const playerRow = Math.floor((this.player.body.y + this.player.body.height) / 32);
            if (Math.abs(alienRow - playerRow) <= 1) {
              const dirToPlayer = this.player.x < enemy.x ? -1 : 1;
              let blocked = false;
              if (this.walkLayer) {
                const checkY = enemy.body.y + enemy.body.height - 1;
                const step = 32 * dirToPlayer;
                for (let x = enemy.x + step; dirToPlayer === 1 ? x < this.player.x : x > this.player.x; x += step) {
                  const tile = this.walkLayer.getTileAtWorldXY(x, checkY);
                  if (tile && tile.index >= 0 && !this.diagonalTileMap.has(tile.index)) { blocked = true; break; }
                }
              }
              if (!blocked) {
                enemy._dir = dirToPlayer;
                enemy.body.setVelocityX(dirToPlayer * 320);
                enemy.flipX = dirToPlayer === -1;
                continue;
              }
            }
          }
        }

        // normal patrol
        if (enemy.body.blocked.left) enemy._dir = 1;
        if (enemy.body.blocked.right) enemy._dir = -1;
        const checkY = enemy.body.y + enemy.body.height + 4;
        const aheadX = enemy.x + enemy._dir * 24;
        let groundTile = this.walkLayer ? this.walkLayer.getTileAtWorldXY(aheadX, checkY) : null;
        if ((!groundTile || groundTile.index < 0) && this.platformLayer) {
          groundTile = this.platformLayer.getTileAtWorldXY(aheadX, checkY);
        }
        if (!groundTile || groundTile.index < 0) enemy._dir *= -1;
        enemy.body.setVelocityX(enemy._dir * enemy._speed);
        enemy.flipX = enemy._dir === -1;
      }
    }

    // update HUD hearts
    if (this._heartSprites && this._heartFrames) {
      const { full, half, empty } = this._heartFrames;
      for (let i = 0; i < this._heartSprites.length; i++) {
        const remaining = this.playerHealth - i * 2;
        let frameKey;
        if (remaining >= 2) frameKey = full;
        else if (remaining === 1) frameKey = half;
        else frameKey = empty;
        this._heartSprites[i].setTexture(frameKey);
      }
    }
  }

  _setupMobileControls() {
    const style = document.createElement('style');
    style.textContent = '@media(max-width:1024px){#game{height:calc(100vh - 160px)!important}}';
    document.head.appendChild(style);
    const btnSizePx = Math.min(window.innerWidth * 0.3, 160);
    const gapPx = Math.min(window.innerWidth * 0.04, 22);
    const vGapPx = Math.min(window.innerWidth * 0.12, 66);
    const fontSizePx = Math.min(window.innerWidth * 0.12, 70);
    const btnStyle = `width:${btnSizePx}px;height:${btnSizePx}px;border-radius:50%;background:rgba(0,0,0,0.5);color:#fff;font-size:${fontSizePx}px;font-weight:bold;border:2px solid rgba(255,255,255,0.4);display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none;touch-action:manipulation;pointer-events:auto;font-family:'Arial Black',Arial,sans-serif;`;
    const container = document.createElement('div');
    container.id = 'mobile-controls';
    container.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:1000;display:flex;justify-content:space-between;align-items:flex-end;padding:10px 35px 20px;pointer-events:none;box-sizing:border-box;';
    const dpad = document.createElement('div');
    const dpadW = btnSizePx * 2 + gapPx;
    const dpadH = btnSizePx;
    dpad.style.cssText = `position:relative;width:${dpadW}px;height:${dpadH}px;pointer-events:none;`;
    const b = (id, l, t, txt) => {
      const el = document.createElement('div');
      el.id = id;
      el.textContent = txt;
      el.style.cssText = `position:absolute;left:${l}px;top:${t}px;${btnStyle}`;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this._onTouchStart(id); });
      el.addEventListener('pointerup', (e) => { e.preventDefault(); this._onTouchEnd(id); });
      el.addEventListener('pointerleave', () => { this._onTouchEnd(id); });
      dpad.appendChild(el);
    };
    b('touch-left', 0, 0, '◀');
    b('touch-right', btnSizePx + gapPx, 0, '▶');
    container.appendChild(dpad);
    const abWrap = document.createElement('div');
    const abW = btnSizePx;
    const abH = btnSizePx * 2 + vGapPx;
    abWrap.style.cssText = `position:relative;width:${abW}px;height:${abH}px;pointer-events:none;`;
    const ab = (id, l, t, bg, txt) => {
      const el = document.createElement('div');
      el.id = id;
      el.textContent = txt;
      el.style.cssText = `position:absolute;left:${l}px;top:${t}px;${btnStyle}background:${bg};`;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this._onTouchStart(id); });
      el.addEventListener('pointerup', (e) => { e.preventDefault(); this._onTouchEnd(id); });
      el.addEventListener('pointerleave', () => { this._onTouchEnd(id); });
      abWrap.appendChild(el);
    };
    ab('touch-b', 0, 0, '#c0392b', 'B');
    ab('touch-a', 0, btnSizePx + vGapPx, '#e74c3c', 'A');
    container.appendChild(abWrap);
    document.body.appendChild(container);
  }

  _onTouchStart(id) {
    if (id === 'touch-left') this._touchLeft = true;
    else if (id === 'touch-right') this._touchRight = true;
    else if (id === 'touch-a') {
      if (!this._touchJump) this._touchJustJump = true;
      this._touchJump = true;
    } else if (id === 'touch-b') {
      this._touchJustShoot = true;
    }
  }

  _onTouchEnd(id) {
    if (id === 'touch-left') this._touchLeft = false;
    else if (id === 'touch-right') this._touchRight = false;
    else if (id === 'touch-a') this._touchJump = false;
  }

  _playAnim(key) {
    if (this.anims.exists(key)) this.player.play(key, true);
  }

  shootBullet() {
    const dir = this.player.flipX ? -1 : 1;
    const bx = this.player.x + dir * 30;
    const by = this.player.y - 57;
    const texKey = this._bulletTexture || '__DEFAULT';
    const bullet = this._bulletGroup.create(bx, by, texKey);
    bullet.setScale(1);
    bullet.setDepth(5);
    bullet.body.setAllowGravity(false);
    bullet.body.setSize(10, 10);
    bullet.setVelocityX(dir * 600);
    this._bullets = this._bullets || [];
    this._bullets.push(bullet);
    if (this.cache.audio.exists('sfx_shot')) this.sound.play('sfx_shot');
    // Remove after 2 seconds
    // Remove after 2 seconds
    this.time.delayedCall(2000, () => {
      if (bullet.active) {
        bullet.destroy();
        this._bullets = this._bullets.filter(b => b.active);
      }
    });
  }

  applySlopeAdjustment() {
    if (!this.player || !this.player.body || !this.diagonalTileMap || this.diagonalTileMap.size === 0) return;
    this._onSlope = false;
    this._slopeType = null;
    const body = this.player.body;
    const feetX = this.player.x;
    const checkY = body.y + body.height - 1;
    let tile = null;
    if (this.walkLayer) tile = this.walkLayer.getTileAtWorldXY(feetX, checkY);
    if ((!tile || !this.diagonalTileMap.has(tile.index)) && this.platformLayer) {
      tile = this.platformLayer.getTileAtWorldXY(feetX, checkY);
    }
    if (tile && this.diagonalTileMap.has(tile.index) && body.velocity.y >= 0) {
      this._onSlope = true;
      this._slopeType = this.diagonalTileMap.get(tile.index);
      body.allowGravity = false;
      body.velocity.y = 0;
      const slopeType = this.diagonalTileMap.get(tile.index);
      const localX = feetX - tile.getLeft();
      const tileH = tile.height;
      let surfaceY;
      if (slopeType === 'diagonal_bottom_left_to_top_right') {
        surfaceY = tile.getTop() + tileH - localX;
      } else if (slopeType === 'diagonal_rop_left_to_bottom_right') {
        surfaceY = tile.getTop() + localX;
      } else {
        this._slopeType = null;
        return;
      }
      const bodyBottom = body.y + body.height;
      const diff = surfaceY - bodyBottom;
      if (Math.abs(diff) > 0.5) {
        this.player.y += diff;
      }
    } else if (this._onSlopePrev) {
      body.allowGravity = true;
      this._slopeType = null;
    }
    this._onSlopePrev = this._onSlope;
  }

  createFramesFromAnnotations(prefix, imageKey, annotations) {
    if (!annotations || !Array.isArray(annotations)) return;
    const srcImage = this.textures.get(imageKey).getSourceImage();
    annotations.forEach((a, i) => {
      const key = `${prefix}_${i}`;
      // create canvas texture
      const canvasTex = this.textures.createCanvas(key, a.width, a.height);
      const ctx = canvasTex.getContext();
      ctx.clearRect(0, 0, a.width, a.height);
      // draw the cropped region from the source image
      ctx.drawImage(srcImage, a.x, a.y, a.width, a.height, 0, 0, a.width, a.height);
      canvasTex.refresh();
    });
  }

  createCharacterFrames() {
    const annotations = this.cache.json.get('character_annot');
    if (!annotations || !Array.isArray(annotations)) return null;
    const srcImage = this.textures.get('character_img').getSourceImage();
    const byType = { walk: [], idle: [], jump: [], shoot: [] };
    annotations.forEach((a, i) => {
      const key = `char_${i}`;
      const canvasTex = this.textures.createCanvas(key, a.width, a.height);
      const ctx = canvasTex.getContext();
      ctx.clearRect(0, 0, a.width, a.height);
      ctx.drawImage(srcImage, a.x, a.y, a.width, a.height, 0, 0, a.width, a.height);
      canvasTex.refresh();
      const nl = a.name.toLowerCase();
      if (nl.startsWith('walk')) byType.walk.push(key);
      else if (nl.startsWith('idle')) byType.idle.push(key);
      else if (nl.startsWith('jump')) byType.jump.push(key);
      else if (nl.startsWith('shoot')) byType.shoot.push(key);
    });
    return byType;
  }

  createEnemyFrames() {
    const annotations = this.cache.json.get('alienbot_annot');
    if (!annotations || !Array.isArray(annotations)) return null;
    const srcImage = this.textures.get('alienbot_img').getSourceImage();
    const byType = { walk: [], exploding: [], dead: [] };
    annotations.forEach((a, i) => {
      const key = `alien_${i}`;
      const canvasTex = this.textures.createCanvas(key, a.width, a.height);
      const ctx = canvasTex.getContext();
      ctx.clearRect(0, 0, a.width, a.height);
      ctx.drawImage(srcImage, a.x, a.y, a.width, a.height, 0, 0, a.width, a.height);
      canvasTex.refresh();
      const nl = a.name.toLowerCase();
      if (nl.startsWith('walk')) byType.walk.push(key);
      else if (nl.startsWith('explod')) byType.exploding.push(key);
      else if (nl.startsWith('dead')) byType.dead.push(key);
    });
    return byType;
  }

  createBlueEnemyFrames() {
    const annotations = this.cache.json.get('blue_alienbot_annot');
    if (!annotations || !Array.isArray(annotations)) return null;
    const srcImage = this.textures.get('blue_alienbot_img').getSourceImage();
    const byType = { walk: [], exploding: [], dead: [] };
    annotations.forEach((a, i) => {
      const key = `blue_alien_${i}`;
      const canvasTex = this.textures.createCanvas(key, a.width, a.height);
      const ctx = canvasTex.getContext();
      ctx.clearRect(0, 0, a.width, a.height);
      ctx.drawImage(srcImage, a.x, a.y, a.width, a.height, 0, 0, a.width, a.height);
      canvasTex.refresh();
      const nl = a.name.toLowerCase();
      if (nl.startsWith('walk')) byType.walk.push(key);
      else if (nl.startsWith('explod')) byType.exploding.push(key);
      else if (nl.startsWith('dead')) byType.dead.push(key);
    });
    return byType;
  }

  createHudHeartFrames() {
    const annotations = this.cache.json.get('hud_annot');
    if (!annotations || !Array.isArray(annotations)) return null;
    const srcImage = this.textures.get('hud_img').getSourceImage();
    const hearts = {};
    let bulletKey = null;
    annotations.forEach((a, i) => {
      const key = `hud_${i}`;
      const canvasTex = this.textures.createCanvas(key, a.width, a.height);
      const ctx = canvasTex.getContext();
      ctx.clearRect(0, 0, a.width, a.height);
      ctx.drawImage(srcImage, a.x, a.y, a.width, a.height, 0, 0, a.width, a.height);
      canvasTex.refresh();
      if (a.name === 'heart full') hearts.full = key;
      else if (a.name === 'heart half') hearts.half = key;
      else if (a.name === 'heart empty') hearts.empty = key;
      else if (a.name === 'bullet') bulletKey = key;
    });
    if (!bulletKey) return null;
    return { hearts: hearts.full && hearts.half && hearts.empty ? hearts : null, bullet: bulletKey };
  }

}

// Convert an infinite Tiled JSON (with layer.chunks) into a finite tilemap JSON
function convertInfiniteToFinite(tmj) {
  const out = Object.assign({}, tmj);
  out.infinite = false;
  // compute bounds from all chunks
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  tmj.layers.forEach(layer => {
    if (layer.chunks && Array.isArray(layer.chunks)) {
      layer.chunks.forEach(c => {
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x + c.width);
        maxY = Math.max(maxY, c.y + c.height);
      });
    }
  });
  if (!isFinite(minX)) {
    // nothing to convert
    return tmj;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  out.width = width;
  out.height = height;
  // convert each layer
  out.layers = tmj.layers.map(layer => {
    if (layer.type !== 'tilelayer' || !layer.chunks) {
      // copy non-tile layers as-is
      return Object.assign({}, layer);
    }
    const data = new Array(width * height).fill(0);
    layer.chunks.forEach(chunk => {
      const cw = chunk.width;
      const ch = chunk.height;
      for (let cy = 0; cy < ch; cy++) {
        for (let cx = 0; cx < cw; cx++) {
          const srcIndex = cy * cw + cx;
          const tileId = chunk.data[srcIndex] || 0;
          const gx = chunk.x - minX + cx;
          const gy = chunk.y - minY + cy;
          if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
            data[gy * width + gx] = tileId;
          }
        }
      }
    });
    const newLayer = Object.assign({}, layer);
    delete newLayer.chunks;
    newLayer.data = data;
    newLayer.width = width;
    newLayer.height = height;
    newLayer.x = 0;
    newLayer.y = 0;
    return newLayer;
  });
  return out;
}

function setupMapAndPlayer(map, tileset) {
  // Create all visual layers in correct order
  const bgLayer = map.createLayer('Background', tileset, 0, 0);
  if (bgLayer) bgLayer.setDepth(0);
  const bgParallaxLayer = map.createLayer('BackgroundParallax', tileset, 0, 0);
  if (bgParallaxLayer) bgParallaxLayer.setDepth(1);
  const bgObjectsLayer = map.createLayer('BackgroundObjects', tileset, 0, 0);
  if (bgObjectsLayer) bgObjectsLayer.setDepth(2);
  const walkLayer = map.createLayer('Walk on', tileset, 0, 0);
  if (walkLayer) walkLayer.setDepth(3);
  const platformLayer = map.createLayer('Walk on and jump through', tileset, 0, 0);
  if (platformLayer) platformLayer.setDepth(4);
  const fgLayer = map.createLayer('Foreground', tileset, 0, 0);
  if (fgLayer) fgLayer.setDepth(5);
  // Create the Character spawn point layer if it exists (invisible, used for spawn detection)
  const spawnTileLayer = map.createLayer('Character spawn point', tileset, 0, 0);
  if (spawnTileLayer) spawnTileLayer.setVisible(false);

  // Create the Enemy spawn points layer (invisible)
  const enemySpawnLayer = map.createLayer('Enemy spawn points', tileset, 0, 0);
  if (enemySpawnLayer) enemySpawnLayer.setVisible(false);

  // set collisions on all non-empty tiles
  if (walkLayer) {
    try {
      // detect whether this layer uses -1 (ARRAY_2D) or 0 (TILED_JSON) for empty
      let usesNegOne = false;
      walkLayer.forEachTile(tile => {
        if (tile && typeof tile.index === 'number' && tile.index < 0) usesNegOne = true;
      });
      walkLayer.setCollisionByExclusion([usesNegOne ? -1 : 0]);
    } catch (e) {
      try { walkLayer.setCollisionByExclusion([0]); } catch (e2) { /* ignore */ }
    }
  }

  // world bounds from map
  const worldWidth = map.widthInPixels;
  const worldHeight = map.heightInPixels;
  this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

  // Store walkLayer, platformLayer and build diagonal tile map for slope handling
  this.walkLayer = walkLayer;
  this.platformLayer = platformLayer;
  this.diagonalTileMap = new Map();
  const tsMetaDiagonal = this.cache.json.get('tileset_tsj');
  if (tsMetaDiagonal && tsMetaDiagonal.tiles) {
    tsMetaDiagonal.tiles.forEach(t => {
      if (t.type === 'diagonal_bottom_left_to_top_right' || t.type === 'diagonal_rop_left_to_bottom_right') {
        this.diagonalTileMap.set(t.id, t.type);
      }
    });
  }
  // Remove collision from diagonal tiles on both layers
  const removeDiagCollision = (layer) => {
    if (layer && this.diagonalTileMap.size > 0) {
      try {
        layer.forEachTile(tile => {
          if (tile && this.diagonalTileMap.has(tile.index)) tile.setCollision(false);
        });
      } catch (e) {}
    }
  };
  removeDiagCollision(walkLayer);
  removeDiagCollision(platformLayer);

  // create character frames from the single spritesheet
  const charFrames = this.createCharacterFrames();

  // create player and scale down to match tile size
  this.player = this.physics.add.sprite(100, 100, charFrames && charFrames.idle.length ? charFrames.idle[0] : 'char_0');
  const PLAYER_SCALE = 0.3;
  this.player.setOrigin(0.5, 1);
  this.player.setScale(PLAYER_SCALE);
  this.player.setDepth(4.5);
  this.player.setCollideWorldBounds(true);
  const bodyW = Math.floor(this.player.width * 0.6);
  const bodyH = Math.floor(this.player.height * 0.85);
  this.player.body.setSize(bodyW, bodyH);
  const offsetX = Math.floor((this.player.width - bodyW) / 2);
  const offsetY = Math.floor(this.player.height - bodyH);
  this.player.body.setOffset(offsetX, offsetY);
  this.player.body.bounce.set(0);

  // player animations from single-sprite frames
  if (charFrames) {
    if (charFrames.walk.length) {
      this.anims.create({ key: 'walk', frames: charFrames.walk.map(k => ({ key: k })), frameRate: 8, repeat: -1 });
    }
    if (charFrames.idle.length) {
      this.anims.create({ key: 'idle', frames: charFrames.idle.map(k => ({ key: k })), frameRate: 6, repeat: -1 });
    }
    if (charFrames.jump.length) {
      const mid = Math.floor(charFrames.jump.length / 2);
      this.anims.create({ key: 'jump_up', frames: charFrames.jump.slice(0, mid).map(k => ({ key: k })), frameRate: 12, repeat: 0 });
      this.anims.create({ key: 'jump_down', frames: charFrames.jump.slice(mid).map(k => ({ key: k })), frameRate: 12, repeat: 0 });
    }
    if (charFrames.shoot.length) {
      const [idle, aim, shooting] = charFrames.shoot;
      this.anims.create({ key: 'shoot', frames: [idle, aim, shooting, aim, idle].map(k => ({ key: k })), frameRate: 8, repeat: 0 });
    }
  }

  // collisions — zero vertical velocity only when actually on ground
  if (walkLayer) {
    this.physics.add.collider(this.player, walkLayer, (_p) => { if (_p.body.blocked.down) _p.body.velocity.y = 0; });
  }

  // one-way platform collisions (jump through from below)
  if (platformLayer) {
    let emptyIdx = 0;
    platformLayer.forEachTile(t => { if (t && t.index < 0) emptyIdx = -1; });
    platformLayer.setCollisionByExclusion([emptyIdx]);
    // Remove collision from diagonal tiles on platform layer
    if (this.diagonalTileMap && this.diagonalTileMap.size > 0) {
      try {
        platformLayer.forEachTile(tile => {
          if (tile && this.diagonalTileMap.has(tile.index)) tile.setCollision(false);
        });
      } catch (e) {}
    }
    this.physics.add.collider(this.player, platformLayer, (_p) => { if (_p.body.blocked.down) _p.body.velocity.y = 0; }, (player, tile) => {
      return player.body.velocity.y >= 0 && player.body.y + player.body.height <= tile.y + tile.height / 2;
    });
  }

  // Determine which tile index represents empty for this layer and set collisions accordingly
  if (walkLayer) {
    try {
      // If tileset is present, use setCollisionByExclusion([0]) (Tiled export uses 0 as empty)
      if (tileset) {
        walkLayer.setCollisionByExclusion([0]);
      } else {
        // otherwise collect all non-empty tile indices from this layer and enable collisions for them
        const indices = new Set();
        walkLayer.forEachTile(tile => {
          if (tile && typeof tile.index === 'number' && tile.index >= 0) indices.add(tile.index);
        });
        const idxArray = Array.from(indices).filter(idx => !this.diagonalTileMap || !this.diagonalTileMap.has(idx));
        if (idxArray.length) walkLayer.setCollision(idxArray);
      }
    } catch (e) {
      let emptyIdx = 0;
      try { walkLayer.forEachTile(t => { if (t && t.index < 0) emptyIdx = -1; }); } catch (e2) {}
      walkLayer.setCollisionByExclusion([emptyIdx]);
    }
    // Safety net: re-remove diagonal tile collision (in case catch block overrode it)
    const removeDiagCollision = (layer) => {
      if (layer && this.diagonalTileMap && this.diagonalTileMap.size > 0) {
        try {
          layer.forEachTile(tile => {
            if (tile && this.diagonalTileMap.has(tile.index)) tile.setCollision(false);
          });
        } catch (e) {}
      }
    };
    removeDiagCollision(walkLayer);
    removeDiagCollision(platformLayer);
  }

  // If possible, place player on top of the first non-empty tile in Walk on layer
  if (walkLayer) {
    let spawnTile = null;
    try {
      walkLayer.forEachTile(tile => {
        if (!spawnTile && tile && tile.index > 0) spawnTile = tile;
      });
    } catch (e) {
      // ignore if layer iteration not available
      spawnTile = null;
    }
      // Determine spawn tile: prefer an object layer with objects of type/class 'character_spawn_point',
      // otherwise search tile layers for tiles whose tileset entry has type 'character_spawn_point'.
      let spawnX = null, spawnTileTop = null, spawnMethod = null;
      // 0) explicit tile layer named 'character spawn point'
      try {
        const explicit = map.getLayer && (map.getLayer('character spawn point') || map.getLayer('Character spawn point'));
        const tileLayer = explicit && (explicit.tilemapLayer || explicit);
        if (tileLayer && typeof tileLayer.forEachTile === 'function') {
          let found = false;
          tileLayer.forEachTile(tile => {
            if (found || !tile || tile.index < 0) return;
            spawnX = tile.getCenterX ? tile.getCenterX() : (tile.pixelX + (tile.width || 32)/2);
            spawnTileTop = (typeof tile.getTop === 'function') ? tile.getTop() : tile.pixelY;
            found = true;
          });
          if (spawnX !== null) spawnMethod = 'explicit-tile-layer';
        }
      } catch (e) {}

      // 1) object layer search in map.mapData (if provided)
      try {
        const mapData = map.mapData || (map && map.map && map.map.mapData) || null;
        if (mapData && Array.isArray(mapData.layers)) {
          for (const lyr of mapData.layers) {
            if (lyr.type === 'objectgroup' && Array.isArray(lyr.objects)) {
              const obj = lyr.objects.find(o => (o.type && o.type === 'character_spawn_point') || (o.class && o.class === 'character_spawn_point'));
              if (obj) {
                spawnX = (obj.x || 0) + ((obj.width || 0) / 2);
                spawnTileTop = (obj.y || 0) - (obj.height || 0);
                break;
              }
            }
          }
        }
      } catch (e) {}

      // 2) tile-based spawn: check tileset metadata for tiles flagged as character_spawn_point
      if (spawnX === null) {
        try {
          const tsMeta = this.cache.json.get('tileset_tsj');
          const spawnTileIds = new Set((tsMeta && tsMeta.tiles || []).filter(t => t.type === 'character_spawn_point').map(t => t.id));
          if (spawnTileIds.size > 0) {
            // iterate layer names known on map (fakeMap exposes layerNames)
            const layerNames = map.layerNames || (map.layers && map.layers.map(l => l.name)) || [];
            for (const lname of layerNames) {
              const lyr = map.getLayer && map.getLayer(lname);
              const tileLayer = lyr && (lyr.tilemapLayer || lyr);
              if (!tileLayer || typeof tileLayer.forEachTile !== 'function') continue;
              let found = false;
              tileLayer.forEachTile(tile => {
                if (found || !tile) return;
                // compute local id: for fakeMap tiles local id equals tile.index; for real tiles, subtract tileset.firstgid if available
                let localId = tile.index;
                try {
                  if (tileset && typeof tileset.firstgid === 'number') localId = tile.index - tileset.firstgid;
                  else if (typeof map.firstgid === 'number') localId = tile.index - map.firstgid;
                } catch (e) {}
                if (spawnTileIds.has(localId)) {
                  spawnX = tile.getCenterX ? tile.getCenterX() : (tile.pixelX + (tile.width || 32)/2);
                  spawnTileTop = (typeof tile.getTop === 'function') ? tile.getTop() : tile.pixelY;
                  found = true;
                }
              });
              if (spawnX !== null) { spawnMethod = 'tileset-typed-tile'; break; }
            }
          }
        } catch (e) { console.warn('spawn tile detection failed', e); }
      }

      // 3) fallback: first non-empty tile in walkLayer
      if (spawnX === null) {
        try {
          let found = false;
          walkLayer.forEachTile(tile => {
            if (found || !tile || tile.index < 0) return;
            spawnX = tile.getCenterX ? tile.getCenterX() : (tile.pixelX + (tile.width || 32)/2);
            spawnTileTop = (typeof tile.getTop === 'function') ? tile.getTop() : tile.pixelY;
            found = true;
          });
          if (spawnX !== null) spawnMethod = 'walk-layer-fallback';
        } catch (e) {}
      }

      // 4) use spawnPos from Character spawn point layer (extracted from raw map data)
      if (spawnX === null && map.spawnPos) {
        spawnX = map.spawnPos.x;
        spawnTileTop = map.spawnPos.y;
        spawnMethod = 'spawn-layer-raw';
      }

      if (spawnX !== null && spawnTileTop !== null) {
        console.log('spawn chosen method:', spawnMethod, 'spawnX:', spawnX, 'tileTop:', spawnTileTop);
        const tileTop = spawnTileTop;
        // compute y so the sprite bottom is placed near tileTop, then correct using live body
        const displayH = this.player.displayHeight || (this.player.height * this.player.scaleY);
        const SPAWN_EXTRA_NUDGE = -6;
        let desiredY = tileTop + SPAWN_EXTRA_NUDGE;
        this.player.setPosition(spawnX, desiredY);
        // delayed correction
        this.time.delayedCall(50, () => {
          if (!this.player || !this.player.body) return;
          this.player.body.velocity.y = 0;
          if (typeof this.player.body.updateFromGameObject === 'function') this.player.body.updateFromGameObject();
          const bodyY = this.player.body.y;
          const bodyHLive = this.player.body.height;
          const bodyBottomLive = bodyY + bodyHLive;
          console.log('delayed align check:', { tileTop, desiredY, bodyY, bodyHLive, bodyBottomLive });
          const diffLive = bodyBottomLive - tileTop;
          if (Math.abs(diffLive) > 0.5) {
            const newY = this.player.y - diffLive;
            console.log('adjusting player by', -diffLive, 'to newY', newY);
            this.player.setPosition(spawnX, newY);
            if (typeof this.player.body.updateFromGameObject === 'function') this.player.body.updateFromGameObject();
            if (this.player.body) this.player.body.velocity.y = 0;
            const bodyBottomAfter = (this.player.body.y || 0) + (this.player.body.height || 0);
            console.log('after delayed adjust bodyBottomAfter vs tileTop', { bodyBottomAfter, tileTop, diffAfter: bodyBottomAfter - tileTop });
          }
        });
      }
  }

  // camera
  this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
  this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);

  // controls: arrows, WASD, space
  this.cursors = this.input.keyboard.createCursorKeys();
  this.keys = this.input.keyboard.addKeys({ W: 'W', A: 'A', S: 'S', D: 'D', SPACE: 'SPACE', SHIFT: 'SHIFT', CTRL: 'CTRL', F: 'F' });
  this.input.keyboard.addCapture(17); // CTRL key code

  // physics tuning
  this.player.setBounce(0);
  this.player.setDragX(600);
  this.speed = 220;
  this.jumpSpeed = 550;

  // --- enemy setup ---
  const enemyFrames = this.createEnemyFrames();
  if (enemyFrames) {
    if (enemyFrames.walk.length) {
      this.anims.create({ key: 'alien_walk', frames: enemyFrames.walk.map(k => ({ key: k })), frameRate: 6, repeat: -1 });
    }
    if (enemyFrames.exploding.length) {
      this.anims.create({ key: 'alien_exploding', frames: enemyFrames.exploding.map(k => ({ key: k })), frameRate: 8, repeat: 0 });
    }
    if (enemyFrames.dead.length) {
      this.anims.create({ key: 'alien_dead', frames: enemyFrames.dead.map(k => ({ key: k })), frameRate: 6, repeat: 0 });
    }
  }

  // --- blue enemy setup ---
  const blueEnemyFrames = this.createBlueEnemyFrames();
  if (blueEnemyFrames) {
    if (blueEnemyFrames.walk.length) {
      this.anims.create({ key: 'blue_alien_walk', frames: blueEnemyFrames.walk.map(k => ({ key: k })), frameRate: 6, repeat: -1 });
    }
    if (blueEnemyFrames.exploding.length) {
      this.anims.create({ key: 'blue_alien_exploding', frames: blueEnemyFrames.exploding.map(k => ({ key: k })), frameRate: 8, repeat: 0 });
    }
    if (blueEnemyFrames.dead.length) {
      this.anims.create({ key: 'blue_alien_dead', frames: blueEnemyFrames.dead.map(k => ({ key: k })), frameRate: 6, repeat: 0 });
    }
  }

  this.enemies = [];
  if (enemySpawnLayer && enemyFrames) {
    const ENEMY_SCALE = 0.4;
    enemySpawnLayer.forEachTile(tile => {
      if (!tile || tile.index < 0) return;
      let localId = tile.index;
      if (tileset && typeof tileset.firstgid === 'number') localId = tile.index - tileset.firstgid;
      if (localId !== 1090 && localId !== 1091) return;
      const isBlue = localId === 1091;
      const frames = isBlue ? blueEnemyFrames : enemyFrames;
      const walkAnim = isBlue ? 'blue_alien_walk' : 'alien_walk';
      const explodeAnim = isBlue ? 'blue_alien_exploding' : 'alien_exploding';
      const deadAnim = isBlue ? 'blue_alien_dead' : 'alien_dead';
      const ex = tile.getCenterX ? tile.getCenterX() : (tile.pixelX + 16);
      const ey = tile.pixelY;
      const enemy = this.physics.add.sprite(ex, ey, frames.walk.length ? frames.walk[0] : (isBlue ? 'blue_alien_0' : 'alien_0'));
      enemy.setOrigin(0.5, 1);
      enemy.setScale(ENEMY_SCALE);
      enemy.setDepth(4.5);
      enemy.setCollideWorldBounds(true);
      enemy.body.bounce.set(0);
      enemy.hp = 3;
      enemy._isDead = false;
      enemy._isBlue = isBlue;
      if (walkLayer) this.physics.add.collider(enemy, walkLayer);
      if (platformLayer) this.physics.add.collider(enemy, platformLayer);
      if (this.anims.exists(walkAnim)) enemy.play(walkAnim);
      enemy._dir = Math.random() < 0.5 ? 1 : -1;
      enemy._speed = 40;
      enemy.on('animationcomplete', (anim) => {
        if (anim.key === explodeAnim) {
          if (enemy._isDead) {
            if (this.anims.exists(deadAnim)) enemy.play(deadAnim);
          } else if (this.anims.exists(walkAnim)) {
            enemy.play(walkAnim);
          }
        }
      });
      this.enemies.push(enemy);
    });
  }

  // --- HUD & health ---
  this.playerHealth = 6;
  this._invulnUntil = 0;
  const hudFrames = this.createHudHeartFrames();
  this._heartFrames = hudFrames ? hudFrames.hearts : null;
  this._bulletTexture = hudFrames ? hudFrames.bullet : null;
  this._heartSprites = [];
  if (this._heartFrames) {
    for (let i = 0; i < 3; i++) {
      const heart = this.add.image(20 + i * 22, 20, this._heartFrames.full);
      heart.setScrollFactor(0);
      heart.setDepth(100);
      this._heartSprites.push(heart);
    }
  }

  // bullet group + walk layer collision
  this._bulletGroup = this.physics.add.group();
  if (walkLayer) {
    this.physics.add.collider(this._bulletGroup, walkLayer, (_bullet) => { if (_bullet.active) _bullet.destroy(); });
  }

  // player-enemy damage collision
  if (this.enemies.length) {
    for (const enemy of this.enemies) {
      this.physics.add.overlap(this.player, enemy, () => {
        if (enemy._isDead) return;
        if (this.time.now < this._invulnUntil) return;
        this.playerHealth--;
        this._invulnUntil = this.time.now + 1000;
        if (this.cache.audio.exists('sfx_hit')) this.sound.play('sfx_hit');
        if (this.playerHealth <= 0) {
          this.playerHealth = 0;
          this.scene.restart();
        }
      });
    }
  }
}


const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 800,
  height: 600,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 600
  },
  render: {
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    transparent: false
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 1400 },
      debug: false
    }
  },
  scene: [MainScene]
};

window.addEventListener('load', () => {
  new Phaser.Game(config);
});