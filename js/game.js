class MainScene extends Phaser.Scene {
  constructor() { super('MainScene'); }

  preload() {
    // map & tiles
    this.load.tilemapTiledJSON('map1', 'sprites/map1.tmj');
    this.load.image('tiles', 'sprites/tileset.png');

    // character images and annotations
    this.load.image('walking_img', 'sprites/character/walking.png');
    this.load.image('shooting_img', 'sprites/character/shooting.png');
    this.load.json('walking_annot', 'sprites/character/walking_anotation.json');
    this.load.json('shooting_annot', 'sprites/character/shooting_annotation.json');
  }

  create() {
    const map = this.make.tilemap({ key: 'map1' });
    const tileset = map.addTilesetImage('tileset', 'tiles');

    // Create background & collision layers if present
    const bgLayer = map.createLayer('Background', tileset, 0, 0);
    const walkLayer = map.createLayer('Walk on', tileset, 0, 0);

    // set collisions on all non-empty tiles
    if (walkLayer) {
      walkLayer.setCollisionByExclusion([0]);
    }

    // world bounds from map
    const worldWidth = map.widthInPixels;
    const worldHeight = map.heightInPixels;
    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

    // create textures from annotations (variable-sized frames)
    this.createFramesFromAnnotations('walking', 'walking_img', this.cache.json.get('walking_annot'));
    this.createFramesFromAnnotations('shooting', 'shooting_img', this.cache.json.get('shooting_annot'));

    // create player at a reasonable start
    this.player = this.physics.add.sprite(100, 100, 'walking_0');
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(this.player.width * 0.6, this.player.height * 0.9);

    // player animations (walking frames)
    const walkFrames = this.textures.getTextureKeys().filter(k => k.startsWith('walking_'));
    if (walkFrames.length) {
      this.anims.create({
        key: 'walk',
        frames: walkFrames.map(k => ({ key: k })),
        frameRate: 8,
        repeat: -1
      });
    }

    const shootFrames = this.textures.getTextureKeys().filter(k => k.startsWith('shooting_'));
    if (shootFrames.length) {
      this.anims.create({ key: 'shoot', frames: shootFrames.map(k => ({ key: k })), frameRate: 6, repeat: 0 });
    }

    // collisions
    if (walkLayer) this.physics.add.collider(this.player, walkLayer);

    // camera
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);

    // controls: arrows, WASD, space
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({ W: 'W', A: 'A', S: 'S', D: 'D', SPACE: 'SPACE' });

    // simple HUD
    this.add.text(10, 10, 'Move: WASD / Arrows   Jump: W / Up / Space', { font: '16px sans-serif', fill: '#fff' }).setScrollFactor(0);

    // physics tuning
    this.player.setBounce(0.05);
    this.player.setDragX(600);
    this.speed = 220;
    this.jumpSpeed = 420;
  }

  update() {
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

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 800,
  height: 600,
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