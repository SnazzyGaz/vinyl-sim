"""Closed, millimetre-scale relief disc sampled directly from a height-map PNG.
Exports are visualization meshes, not guaranteed playable manufacturing files.
"""
import argparse
from pathlib import Path
import numpy as np
from scipy.ndimage import map_coordinates
import trimesh
from decode import read_map

def build(path, outbase, radial=384, angular=1024):
    image,m=read_map(path); n=image.shape[0]; R=m['disc_radius_mm']
    # Sample very slightly inside the raster rim to avoid interpolation with black
    # outside-disc pixels. The last ring is placed at the exact physical radius.
    radii=np.linspace(R/radial,R,radial)
    theta=np.arange(angular)*2*np.pi/angular
    rr=radii[:,None];xx=rr*np.cos(theta);yy=rr*np.sin(theta)
    sample_r=np.minimum(rr,R-2*R/(n-1))
    px=(sample_r*np.cos(theta)+R)*(n-1)/(2*R)
    py=(R-sample_r*np.sin(theta))*(n-1)/(2*R)
    z=map_coordinates(image,[py.ravel(),px.ravel()],order=1).reshape(xx.shape)/65535*m['height_scale_mm']
    # Label is a flat, single surface; centre fan matches it exactly.
    z=np.where(rr<=m['label_radius_mm'],m['thickness_mm'],z)
    verts=np.column_stack([xx.ravel(),yy.ravel(),z.ravel()])
    center=len(verts);verts=np.vstack([verts,[0,0,m['thickness_mm']]])
    ids=np.arange(radial*angular).reshape(radial,angular)
    a=ids[:-1].ravel();b=np.roll(ids[:-1],-1,axis=1).ravel();c=ids[1:].ravel();d=np.roll(ids[1:],-1,axis=1).ravel()
    faces=[np.column_stack([a,c,b]),np.column_stack([b,c,d])]
    j=np.arange(angular); j1=(j+1)%angular
    faces.append(np.column_stack([np.full(angular,center),j,j1]))
    rim=ids[-1];bottom=len(verts)
    verts=np.vstack([verts,np.column_stack([R*np.cos(theta),R*np.sin(theta),np.zeros(angular)]),[0,0,0]])
    bc=len(verts)-1
    faces.extend([np.column_stack([rim,bottom+j,bottom+j1]),np.column_stack([rim,bottom+j1,rim[j1]]),np.column_stack([np.full(angular,bc),bottom+j1,bottom+j])])
    mesh=trimesh.Trimesh(verts,np.vstack(faces),process=False)
    depth=np.clip((m['thickness_mm']-verts[:,2])/m['groove_depth_mm'],0,1)
    v=(14+depth*8).astype(np.uint8)
    colors=np.column_stack([v,v,v,np.full(len(v),255,dtype=np.uint8)])
    label=np.hypot(verts[:,0],verts[:,1])<m['label_radius_mm']
    colors[label]=[196,36,32,255];mesh.visual.vertex_colors=colors
    trimesh.repair.fix_normals(mesh)
    outbase=Path(outbase);mesh.export(str(outbase)+'.glb');mesh.export(str(outbase)+'.stl')
    return dict(vertices=len(mesh.vertices),triangles=len(mesh.faces),watertight=bool(mesh.is_watertight),volume_mm3=float(mesh.volume),radial_segments=radial,angular_segments=angular,warning='Preview-resolution relief from PNG depth pixels; vector master (when supplied) remains playback source. Tiny grooves can be lost, especially on long recordings. Not a playable physical record guarantee.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('png');p.add_argument('outbase');a=p.parse_args();print(build(a.png,a.outbase))
