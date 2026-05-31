#!/usr/bin/env python3
"""
Generate simple annotation JSON for a spritesheet by slicing it into a grid.
Does NOT modify any TMJ files.

Usage:
  python tools/generate_annotations.py --input sprites/character/walking.png --out sprites/character/walking_auto_annotation.json --frame-width 120 --frame-height 280

The script requires Pillow:
  pip install Pillow

It will write a JSON array of {name,x,y,width,height} for each frame found left-to-right, top-to-bottom.
"""

import argparse
import json
from PIL import Image
import os


def generate_annotations(img_path, frame_w, frame_h, prefix='frame'):
    img = Image.open(img_path)
    w, h = img.size
    annotations = []
    idx = 0
    for y in range(0, h, frame_h):
        for x in range(0, w, frame_w):
            # avoid frames that extend beyond image bounds
            if x + frame_w <= w and y + frame_h <= h:
                annotations.append({
                    'name': f"{prefix}_{idx}",
                    'x': x,
                    'y': y,
                    'width': frame_w,
                    'height': frame_h
                })
                idx += 1
    return annotations


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', '-i', required=True, help='Input image path')
    p.add_argument('--frame-width', '-fw', type=int, required=True)
    p.add_argument('--frame-height', '-fh', type=int, required=True)
    p.add_argument('--out', '-o', required=True, help='Output JSON path')
    p.add_argument('--prefix', default='frame')
    args = p.parse_args()

    anns = generate_annotations(args.input, args.frame_width, args.frame_height, args.prefix)
    out_dir = os.path.dirname(args.out)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(anns, f, indent=2)
    print(f'Wrote {len(anns)} annotations to {args.out}')

if __name__ == '__main__':
    main()
