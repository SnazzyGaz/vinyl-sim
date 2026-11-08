"""Portable groove displacement master: signed PCM16 mono WAV + spiral JSON.
This is explicitly a sampled 1D vector, not a source upload or CAM toolpath.
"""
import hashlib, json
from pathlib import Path
import numpy as np
from scipy.io import wavfile
from audio_filters import presence
from decode import validate_metadata

FORMAT='pcm16-mono-displacement-v1'

def companion(png): return Path(png).with_suffix('.groove.wav')

def write_vector(path, displacement, m):
    pcm=np.rint(np.clip(displacement,-1,32767/32768)*32768).astype('<i2')
    m['vector_master']=dict(format=FORMAT,sample_count=len(pcm),sha256=hashlib.sha256(pcm.tobytes()).hexdigest(),
        meaning='Prepared lateral displacement / amp_mm; adaptive-filtered, presence-emphasized, peak-normalized. Not the original upload.')
    wavfile.write(path,int(m['sample_rate']),pcm)
    return pcm.astype(float)/32768

def read_vector(path, m=None):
    path=Path(path)
    if m is None:
        side=path.with_name(path.name[:-len('.groove.wav')]+'.json') if path.name.endswith('.groove.wav') else path.with_suffix('.json')
        if not side.exists(): raise ValueError('Vector requires matching spiral JSON metadata.')
        m=json.loads(side.read_text())
    validate_metadata(m)
    v=m.get('vector_master',{})
    if v.get('format')!=FORMAT: raise ValueError('Not a declared groove displacement master.')
    fs,pcm=wavfile.read(path)
    expected=int(round(m['duration_sec']*m['sample_rate']))
    if pcm.dtype!=np.int16 or pcm.ndim!=1 or fs!=m['sample_rate'] or len(pcm)!=expected or len(pcm)!=v.get('sample_count'):
        raise ValueError('Vector must be PCM16 mono with the declared sample rate and duration.')
    if hashlib.sha256(pcm.astype('<i2').tobytes()).hexdigest()!=v.get('sha256'):
        raise ValueError('Vector does not match the PNG/JSON metadata (checksum mismatch).')
    return pcm.astype(float)/32768,m

def decode_vector(path,m=None):
    x,m=read_vector(path,m)
    # Already filtered once by prepare_audio. No raster cleanup / second lowpass.
    return presence(x,int(m['sample_rate']),m,inverse=True),m
