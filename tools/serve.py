#!/usr/bin/env python3
"""
Run the annotation generator (for one image or auto for all character PNGs without annotations)
and then start a simple HTTP server for the project root.

Usage examples:
  # generate annotations for all PNGs in sprites/character missing an annotation, then serve on port 8000
  python tools/serve.py --port 8000

  # generate for a single image and custom frame size, then serve
  python tools/serve.py --input sprites/character/walking.png --frame-width 120 --frame-height 280 --out sprites/character/walking_auto_annotation.json --port 9000

This script calls tools/generate_annotations.py and will not modify .tmj files.
"""

import argparse
import glob
import os
import subprocess
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


def has_annotation_for(img_path):
    base = os.path.splitext(os.path.basename(img_path))[0]
    dirn = os.path.dirname(img_path)
    # consider common annotation name variants
    candidates = [
        os.path.join(dirn, f'{base}_anotation.json'),
        os.path.join(dirn, f'{base}_annotation.json'),
        os.path.join(dirn, f'{base}_auto_annotation.json'),
        os.path.join(dirn, f'{base}.json')
    ]
    return any(os.path.exists(p) for p in candidates)


def run_generate(input_path, fw, fh, out_path, prefix='frame'):
    cmd = [sys.executable, os.path.join('tools', 'generate_annotations.py'), '--input', input_path, '--frame-width', str(fw), '--frame-height', str(fh), '--out', out_path, '--prefix', prefix]
    print('Running:', ' '.join(cmd))
    r = subprocess.run(cmd)
    return r.returncode == 0


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', '-i', help='Specific input image to annotate (optional)')
    p.add_argument('--frame-width', '-fw', type=int, default=120)
    p.add_argument('--frame-height', '-fh', type=int, default=280)
    p.add_argument('--out', '-o', help='Output JSON path (for single input)')
    p.add_argument('--embed-output', help='Write merged tileset JSON here (default: sprites/map1_embedded_tileset.json)', default=os.path.join('sprites', 'map1_embedded_tileset.json'))
    p.add_argument('--port', type=int, default=8000, help='HTTP server port')
    p.add_argument('--host', default='127.0.0.1', help='HTTP server host')
    p.add_argument('--overwrite', action='store_true', help='Always overwrite existing annotation files')
    args = p.parse_args()

    # If an explicit input is provided, generate annotation for that image only.
    if args.input:
        out = args.out or os.path.splitext(args.input)[0] + '_auto_annotation.json'
        success = run_generate(args.input, args.frame_width, args.frame_height, out)
        if not success:
            print('Annotation generation failed for', args.input)
    else:
        # By default, do NOT regenerate character annotations (do not touch walking/shooting).
        # Instead, create an embedded tileset JSON that contains the tileset data Tiled references
        # so the game can load it without modifying the .tmj file.
        tmj_path = os.path.join('sprites', 'map1.tmj')
        tsj_path = None
        firstgid = 1
        try:
            with open(tmj_path, 'r', encoding='utf-8') as f:
                txt = f.read()
                # find tileset source via regex to avoid strict JSON parsing of possibly edited TMJ
                import re
                m = re.search(r'"source"\s*:\s*"([^"]+)"', txt)
                if m:
                    tsj_source = m.group(1)
                    tsj_path = os.path.join(os.path.dirname(tmj_path), tsj_source)
                # try to find firstgid too (optional)
                m2 = re.search(r'"firstgid"\s*:\s*(\d+)', txt)
                if m2:
                    try:
                        firstgid = int(m2.group(1))
                    except Exception:
                        firstgid = 1
        except FileNotFoundError:
            print('Map file not found:', tmj_path)

        if tsj_path and os.path.exists(tsj_path):
            import json
            with open(tsj_path, 'r', encoding='utf-8') as f:
                tsj = json.load(f)
            merged = dict(tsj)
            merged['firstgid'] = firstgid
            out_path = args.embed_output
            if os.path.exists(out_path) and not args.overwrite:
                print('Embedded tileset exists and --overwrite not set, skipping:', out_path)
            else:
                os.makedirs(os.path.dirname(out_path), exist_ok=True)
                with open(out_path, 'w', encoding='utf-8') as wf:
                    json.dump(merged, wf, indent=2)
                print('Wrote embedded tileset JSON to', out_path)
        else:
            print('No external tileset reference found in', tmj_path, 'or tileset file missing. Skipping embed step.')

    # start HTTP server
    os.chdir(os.getcwd())
    addr = (args.host, args.port)
    handler = SimpleHTTPRequestHandler
    httpd = ThreadingHTTPServer(addr, handler)
    # Print reachable URLs (browsers usually use localhost rather than 0.0.0.0)
    display_host = 'localhost' if args.host in ('0.0.0.0', '127.0.0.1') else args.host
    print(f'Serving HTTP on {args.host} port {args.port} (http://{display_host}:{args.port}/) ...')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down server')
        httpd.server_close()


if __name__ == '__main__':
    main()
