class MainScene extends Phaser.Scene {
  constructor() { super('MainScene'); }

  preload() {
    // tiles and tileset metadata (we'll fetch the TMJ ourselves to avoid Phaser parsing external tilesets)
    // try to preload an embedded TMJ (non-destructive copy); if it exists Phaser will handle it
    this.load.tilemapTiledJSON('map1', 'sprites/map1_embedded.tmj');
    this.load.json('tileset_tsj', 'sprites/tileset.tsj');
    this.load.image('tiles', 'sprites/tileset.png');

    // character images and annotations
    this.load.image('walking_img', 'sprites/character/walking.png');
    this.load.image('shooting_img', 'sprites/character/shooting.png');
    this.load.json('walking_annot', 'sprites/character/walking_anotation.json');
    this.load.json('shooting_annot', 'sprites/character/shooting_annotation.json');
  }

  create() {
    // If Phaser already has a preloaded embedded map, use it directly.
    if (this.cache.tilemap && this.cache.tilemap.get('map1')) {
      console.log('cached tilemap entry pre-make:', this.cache.tilemap.get('map1'));
      try {
        const map = this.make.tilemap({ key: 'map1' });
        const tileset = map.addTilesetImage('tileset', 'tiles');
        setupMapAndPlayer.call(this, map, tileset);
        return;
      } catch (e) {
        console.error('make.tilemap failed:', e);
        console.log('cached tilemap raw data keys:', Object.keys(this.cache.tilemap.get('map1') || {}));
        console.log('first tileset in cached data:', (this.cache.tilemap.get('map1') || {}).data && ((this.cache.tilemap.get('map1') || {}).data.tilesets || [])[0]);
      }
    }

    // Load the map JSON ourselves so Phaser doesn't parse external tileset references.
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

      if (this.cache.tilemap && typeof this.cache.tilemap.add === 'function') {
        try {
          // Ensure Phaser recognizes this as TILED_JSON format
          const tiledFormat = (Phaser && Phaser.Tilemaps && Phaser.Tilemaps.Formats && Phaser.Tilemaps.Formats.TILED_JSON) || 0;
          console.log('Phaser.Tilemaps.Formats =', Phaser.Tilemaps && Phaser.Tilemaps.Formats);
          console.log('chosen tiledFormat =', tiledFormat);
            const entry = { data: mapToUse, format: tiledFormat };
          // remove any existing entry then add
          try { this.cache.tilemap.remove('map1'); } catch (e) {}
          this.cache.tilemap.add('map1', entry);
          console.log('tilemap cache entry:', this.cache.tilemap.get('map1'));
          console.log('used tilemap format constant:', entry.format);
          try {
            const d = entry.data;
            console.log('mapToUse width/height:', d.width, d.height, 'layers:', d.layers && d.layers.length);
            if (d.layers && Array.isArray(d.layers)) {
              d.layers.forEach((ly, idx) => {
                console.log(`layer[${idx}] name=${ly.name} type=${ly.type} dataLen=${(ly.data && ly.data.length) || 0}`);
                if (ly.data && ly.data.length) console.log('layer sample:', ly.data.slice(0, 16));
              });
            }
            console.log('tilesets:', d.tilesets && d.tilesets.length, d.tilesets && d.tilesets[0]);
          } catch (e) { console.warn('post-add inspect failed', e); }
          } catch (e) {
            console.warn('Failed to add tilemap to cache.tilemap, falling back to manual layer creation', e);
            // fall through to manual creation below
          }
      } else {
        // manual creation will be used below
      }
      // debug: report which map source was used
      if (mapData && mapData.tilesets && mapData.tilesets[0] && mapData.tilesets[0].image) {
        console.log('Map loaded; tileset image:', mapData.tilesets[0].image || '<n/a>');
      } else {
        console.log('Map loaded (no tileset image found)');
      }

      console.log('mapData keys:', Object.keys(mapData || {}));
      console.log('map layers:', mapData && mapData.layers ? mapData.layers.map(l => l.name) : null);
      console.log('map infinite:', mapData && mapData.infinite);
      // If Phaser's make.tilemap failed earlier for the embedded/external TMJ,
      // create layers manually from the converted finite map and provide a
      // lightweight fake map object for setupMapAndPlayer.
      let finalMap = null;
      let finalTileset = null;
      try {
        finalMap = this.make.tilemap({ key: 'map1' });
        finalTileset = finalMap.addTilesetImage('tileset', 'tiles');
      } catch (e) {
        // manual layer creation
        const created = {};
        const mapWidth = mapToUse.width;
        const mapHeight = mapToUse.height;
        const tw = mapToUse.tilewidth || 32;
        const th = mapToUse.tileheight || 32;
        const tilesetName = (mapToUse.tilesets && mapToUse.tilesets[0] && mapToUse.tilesets[0].name) || 'tileset';

        const createLayerFromName = (name, x=0, y=0) => {
          const layerObj = (mapToUse.layers || []).find(l => l.name === name);
          if (!layerObj || !layerObj.data) return null;
          const firstgid = (mapToUse.tilesets && mapToUse.tilesets[0] && mapToUse.tilesets[0].firstgid) || 1;
          const arr2d = [];
          for (let row = 0; row < mapHeight; row++) {
            const rowArr = [];
            const slice = layerObj.data.slice(row * mapWidth, (row + 1) * mapWidth);
            for (let i = 0; i < slice.length; i++) {
              const gid = slice[i] || 0;
              // Convert Tiled GID to Phaser ARRAY_2D format:
              // Phaser expects tile indexes zero-based and -1 for empty tiles
              // Tiled GIDs start at firstgid; so subtract firstgid to get zero-based index
              rowArr[i] = (gid === 0) ? -1 : (gid - firstgid);
            }
            arr2d[row] = rowArr;
          }
          console.log('createLayerFromName', name, 'mapWidth', mapWidth, 'mapHeight', mapHeight);
          console.log('first row length:', arr2d[0].length, 'first row sample (32):', arr2d[0].slice(0,32));
          // check column variation by sampling first 8 columns across rows
          const colSamples = [];
          for (let c = 0; c < Math.min(8, arr2d[0].length); c++) {
            const colVals = [];
            for (let r = 0; r < Math.min(8, arr2d.length); r++) colVals.push(arr2d[r][c]);
            colSamples.push(colVals);
          }
          console.log('colSamples first 8 cols x 8 rows:', colSamples);
          const tmpMap = this.make.tilemap({ data: arr2d, tileWidth: tw, tileHeight: th });
          console.log('tmpMap props:', tmpMap.width, tmpMap.height, tmpMap.tileWidth, tmpMap.tileHeight);
          const ts = tmpMap.addTilesetImage(tilesetName, 'tiles');
          const layer = tmpMap.createLayer(0, ts, x, y);
          console.log('created layer', name, 'layer size:', layer.layer.width, layer.layer.height);
          // sample tile indices from the created layer
          const tileSamples = [];
          for (let r = 0; r < Math.min(4, layer.layer.height); r++) {
            const rowVals = [];
            for (let c = 0; c < Math.min(8, layer.layer.width); c++) {
              const t = layer.layer.data[r][c];
              rowVals.push(t ? t.index : 0);
            }
            tileSamples.push(rowVals);
          }
          console.log('tileSamples:', tileSamples);
          created[name] = { tmpMap, layer };
          return layer;
        };

        const fakeMap = {
          createLayer: (name, tileset, x, y) => createLayerFromName(name, x, y),
          getLayer: (name) => created[name] ? { tilemapLayer: created[name].layer } : null,
          widthInPixels: (mapToUse.width || 0) * (mapToUse.tilewidth || 32),
          heightInPixels: (mapToUse.height || 0) * (mapToUse.tileheight || 32),
        };

        setupMapAndPlayer.call(this, fakeMap, null);
        return;
      }

      // proceed to create layers and the rest of the scene
      setupMapAndPlayer.call(this, finalMap, finalTileset);
    })();
    // end async IIFE
    return;

    // (map and player setup moved to async branch)
  }

  update() {
    if (!this.player || !this.cursors || !this.keys) return;

    const left = this.cursors.left.isDown || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    const jumpPressed = (this.cursors && this.cursors.up && Phaser.Input.Keyboard.JustDown(this.cursors.up))
      || (this.keys && this.keys.W && Phaser.Input.Keyboard.JustDown(this.keys.W))
      || (this.keys && this.keys.SPACE && Phaser.Input.Keyboard.JustDown(this.keys.SPACE));

    if (left) {
      this.player.setVelocityX(-this.speed);
      this.player.flipX = true;
      if (this.player.body.onFloor() && this.anims.exists('walk')) this.player.play('walk', true);
    } else if (right) {
      this.player.setVelocityX(this.speed);
      this.player.flipX = false;
      if (this.player.body.onFloor() && this.anims.exists('walk')) this.player.play('walk', true);
    } else {
      // idle
      this.player.setVelocityX(0);
      const idleKey = this.textures.getTextureKeys().find(k => k === 'walking_0' || k === 'walking_idle');
      if (idleKey) this.player.setTexture(idleKey);
    }

    const onGround = (this.player.body.blocked && this.player.body.blocked.down) || (this.player.body.touching && this.player.body.touching.down);
    if (jumpPressed && onGround) {
      this.player.setVelocityY(-this.jumpSpeed);
    }
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
  // Create background & collision layers if present
  const bgLayer = map.createLayer('Background', tileset, 0, 0);
  const walkLayer = map.createLayer('Walk on', tileset, 0, 0);

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

  // create textures from annotations (variable-sized frames)
  this.createFramesFromAnnotations('walking', 'walking_img', this.cache.json.get('walking_annot'));
  this.createFramesFromAnnotations('shooting', 'shooting_img', this.cache.json.get('shooting_annot'));

  // create player at a reasonable start
  // create player and scale down to match tile size
  this.player = this.physics.add.sprite(100, 100, 'walking_0');
  const PLAYER_SCALE = 0.3;
  // set origin to bottom-center so positioning is easier (y = bottom)
  this.player.setOrigin(0.5, 1);
  this.player.setScale(PLAYER_SCALE);
  this.player.setCollideWorldBounds(true);
  // adjust physics body to match scaled sprite (narrower and slightly shorter)
  const bodyW = Math.floor(this.player.width * PLAYER_SCALE * 0.6);
  const bodyH = Math.floor(this.player.height * PLAYER_SCALE * 0.85);
  this.player.body.setSize(bodyW, bodyH);
  // center the body horizontally and align bottom of body with sprite bottom
  const offsetX = Math.floor((this.player.displayWidth - bodyW) / 2);
  const offsetY = Math.floor(this.player.displayHeight - bodyH - 2);
  this.player.body.setOffset(offsetX, offsetY);

  // player animations (walking frames)
  // build walking frames: exclude the original source image key and sort numerically
  const walkFrames = this.textures.getTextureKeys().filter(k => k.startsWith('walking_') && k !== 'walking_img')
    .sort((a,b) => (parseInt(a.split('_')[1] || '0',10) - parseInt(b.split('_')[1] || '0',10)));
  if (walkFrames.length) {
    this.anims.create({ key: 'walk', frames: walkFrames.map(k => ({ key: k })), frameRate: 8, repeat: -1 });
  }

  const shootFrames = this.textures.getTextureKeys().filter(k => k.startsWith('shooting_') && k !== 'shooting_img')
    .sort((a,b) => (parseInt(a.split('_')[1] || '0',10) - parseInt(b.split('_')[1] || '0',10)));
  if (shootFrames.length) {
    this.anims.create({ key: 'shoot', frames: shootFrames.map(k => ({ key: k })), frameRate: 6, repeat: 0 });
  }

  // collisions
  if (walkLayer) this.physics.add.collider(this.player, walkLayer);

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
        const idxArray = Array.from(indices);
        if (idxArray.length) walkLayer.setCollision(idxArray);
      }
    } catch (e) {
      // fallback: default behavior
      walkLayer.setCollisionByExclusion([0]);
    }
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
    if (spawnTile) {
      const spawnX = spawnTile.getCenterX ? spawnTile.getCenterX() : (spawnTile.pixelX + (spawnTile.width || 32)/2);
      const tileTop = (typeof spawnTile.getTop === 'function') ? spawnTile.getTop() : spawnTile.pixelY;
      // compute y so the physics body bottom aligns with tileTop:
      const displayH = this.player.displayHeight || (this.player.height * this.player.scaleY);
      const bodyH = (this.player.body && this.player.body.height) || Math.floor(this.player.height * PLAYER_SCALE * 0.85);
      const offsetY = (this.player.body && this.player.body.offset && this.player.body.offset.y) || (this.player.body && this.player.body.offsetY) || 0;
      // initial desired Y so the physics body bottom aligns with tileTop
      let desiredY = tileTop + displayH - offsetY - bodyH;
      this.player.setPosition(spawnX, desiredY);
      // allow physics body to exist/refresh and then compute actual bottom to correct any mismatch
      if (this.player.body) {
        this.player.body.velocity.y = 0;
        const bodyBottom = (this.player.body.y || 0) + (this.player.body.height || 0);
        const diff = bodyBottom - tileTop;
        console.log('spawn align auto-correct:', { tileTop, displayH, bodyH, offsetY, desiredY, bodyBottom, diff });
        if (Math.abs(diff) > 0.5) {
          // move player up by the overlap amount
          desiredY = desiredY - diff;
          this.player.setPosition(spawnX, desiredY);
          // reset velocity after adjustment
          this.player.body.velocity.y = 0;
          const bodyBottom2 = (this.player.body.y || 0) + (this.player.body.height || 0);
          console.log('after adjust bodyBottom2 vs tileTop', { bodyBottom2, tileTop, diff2: bodyBottom2 - tileTop });
        }
      }
    }
  }

  // 'Walk on and jump through' layer: one-way platforms (player can jump up through, land when falling)
  if (map.getLayer('Walk on and jump through')) {
    const jumpLayer = map.createLayer('Walk on and jump through', tileset, 0, 0);
    jumpLayer.setCollisionByExclusion([0]);
    const processCallback = (player, tile) => {
      if (!player.body) return false;
      const vy = player.body.velocity.y;
      const playerBottom = player.body.y + player.body.height;
      const tileTop = (typeof tile.getTop === 'function') ? tile.getTop() : tile.pixelY;
      return vy >= 0 && (playerBottom <= (tileTop + 8));
    };
    this.physics.add.collider(this.player, jumpLayer, null, processCallback, this);
  }

  // camera
  this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
  this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);

  // controls: arrows, WASD, space
  this.cursors = this.input.keyboard.createCursorKeys();
  this.keys = this.input.keyboard.addKeys({ W: 'W', A: 'A', S: 'S', D: 'D', SPACE: 'SPACE' });

  // physics tuning
  this.player.setBounce(0.05);
  this.player.setDragX(600);
  this.speed = 220;
  this.jumpSpeed = 420;
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
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 1000 },
      debug: false
    }
  },
  scene: [MainScene]
};

window.addEventListener('load', () => {
  new Phaser.Game(config);
});