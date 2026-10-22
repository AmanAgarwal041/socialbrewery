#!/usr/bin/env python3
"""Local Kokoro text-to-speech for the Video Studio fallback.

pip install kokoro-onnx soundfile
Model files (kokoro-v1.0.onnx, voices-v1.0.bin) go in $SOCIALBREWERY_HOME/kokoro or ./kokoro.
"""
import argparse, os, sys

ap = argparse.ArgumentParser()
ap.add_argument('--text-file', required=True)
ap.add_argument('--voice', default='am_michael')
ap.add_argument('--out', required=True)
a = ap.parse_args()
try:
    from kokoro_onnx import Kokoro
    import soundfile as sf
except ImportError:
    sys.exit('kokoro-onnx or soundfile is not installed (pip install kokoro-onnx soundfile)')
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
base = os.path.join(os.environ.get('SOCIALBREWERY_HOME', here), 'kokoro')
model, voices = os.path.join(base, 'kokoro-v1.0.onnx'), os.path.join(base, 'voices-v1.0.bin')
if not (os.path.exists(model) and os.path.exists(voices)):
    sys.exit(f'Kokoro model files are missing in {base}')
text = open(a.text_file, encoding='utf-8').read()
samples, rate = Kokoro(model, voices).create(text, voice=a.voice, speed=1.0, lang='en-us')
sf.write(a.out, samples, rate)
