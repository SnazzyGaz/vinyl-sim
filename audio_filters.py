"""Declared, reproducible radius-following filtering and reversible presence shelf."""
import numpy as np
from scipy.signal import stft, istft, lfilter


def shelf_coefficients(fs, frequency=1500., gain_db=6.):
    # RBJ high shelf, slope S=1. Minimum phase: swapping b/a is its exact inverse.
    A=10**(gain_db/40); w=2*np.pi*frequency/fs
    c=np.cos(w); alpha=np.sin(w)/2*np.sqrt(2.); k=2*np.sqrt(A)*alpha
    b=np.array([A*((A+1)+(A-1)*c+k),-2*A*((A-1)+(A+1)*c),A*((A+1)+(A-1)*c-k)])
    a=np.array([(A+1)-(A-1)*c+k,2*((A-1)-(A+1)*c),(A+1)-(A-1)*c-k])
    return b/a[0],a/a[0]


def presence(x, fs, m, inverse=False):
    if m.get('preemphasis') != 'presence-shelf-v1': return x
    p=m['presence_shelf']; b,a=shelf_coefficients(fs,p['frequency_hz'],p['gain_db'])
    return lfilter(a,b,x) if inverse else lfilter(b,a,x)


def radius_cutoff(t, m):
    radius=m['r_start_mm']-m['pitch_mm']*(m['lead_in_turns']+np.asarray(t)*m['rpm_cut']/60)
    pixel=2*m['disc_radius_mm']/(m['image_size']-1)
    return np.minimum(m.get('bandlimit_cap_hz',6500.),2*np.pi*radius/pixel*m['rpm_cut']/60*.44)


def adaptive_bandlimit(x, fs, m):
    """Hann STFT, 75% overlap, smooth 6th-order magnitude rolloff per frame."""
    n=min(m.get('filter_window_samples',1024),len(x)); hop=max(1,n//4)
    f,t,z=stft(x,fs=fs,window='hann',nperseg=n,noverlap=n-hop,boundary='zeros',padded=True)
    cutoff=np.minimum(radius_cutoff(t,m),fs*.44)
    z*=1/np.sqrt(1+(f[:,None]/np.maximum(cutoff,1))**12)
    _,y=istft(z,fs=fs,window='hann',nperseg=n,noverlap=n-hop,boundary=True)
    return y[:len(x)]


def postprocess(x, fs, m):
    if m.get('bandlimit_mode') == 'radius-following-v1':
        return presence(adaptive_bandlimit(x,fs,m),fs,m,inverse=True)
    from scipy.signal import butter,sosfiltfilt
    return presence(sosfiltfilt(butter(4,min(m['bandlimit_hz'],fs*.42),fs=fs,output='sos'),x),fs,m,inverse=True)
