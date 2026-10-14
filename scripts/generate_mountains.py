"""Generate four overlapping, triangulated mountain faces for the landing page."""
from pathlib import Path
import math
import random
import xml.etree.ElementTree as ET

random.seed(303)
BASE = 280
parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 280" preserveAspectRatio="none">']
connection_count = 0

def point(p):
    return f'{p[0]:.1f},{p[1]:.1f}'

def mountain(start, end, summit, height, left_width, right_width, front=False):
    global connection_count
    # Piecewise-linear rock faces: broken shoulders and pointed summits, no curves.
    if summit < 800:
        profile = [(start, .32), (summit-55, .61), (summit, 1),
                   (summit+38, .76), (summit+80, .60),
                   (summit+130, .66), (summit+210, .29), (end, 0)]
    else:
        profile = [(start, .04), (summit-290, .19), (summit-205, .43),
                   (summit-135, .39), (summit-62, .70),
                   (summit, 1), (summit+32, .63), (end, .22)]
    profile = sorted((max(start,min(end,x)), z) for x,z in profile)
    ridge = [(x, BASE-height*z) for x,z in profile]
    # Fan rock faces toward an offset foothill. Each face has its own interior
    # elevation vertex, avoiding parallel copies of the mountain silhouette.
    foot = (summit + (105 if summit < 800 else -145), BASE)
    boundary = [(start,BASE)] + ridge + [(end,BASE)]
    parts.append(f'<path d="M{start},280 L'+ ' L'.join(map(point,ridge)) +f' L{end},280Z" fill="'+('#0e1729' if front else '#1c102d')+'"/>')
    edges = set()
    interior = []
    for i,(a,b) in enumerate(zip(boundary,boundary[1:])):
        # Barycentric positions remain inside each sloping face.
        wa = random.uniform(.22,.38)
        wb = random.uniform(.22,.36)
        wc = 1-wa-wb
        center = (wa*a[0]+wb*b[0]+wc*foot[0], wa*a[1]+wb*b[1]+wc*foot[1])
        interior.append(center)
        triangles = [(a,b,center),(b,foot,center),(foot,a,center)]
        for tri in triangles:
            color = '#00dfff' if front else '#f333cc'
            # Different light on the two faces accentuates the summit-to-foot ridge.
            shade = .12 if (a[0]+b[0])/2 < summit else .045
            opacity = shade * (1 if front else .65) * random.uniform(.65,1.25)
            parts.append(f'<polygon points="{" ".join(map(point,tri))}" fill="{color}" fill-opacity="{opacity:.3f}"/>')
            for v,w in zip(tri, tri[1:]+tri[:1]):
                if v != w:
                    edges.add(tuple(sorted((v,w))))
    connection_count += len(edges)
    color = '#54dfe9' if front else '#d77fdd'
    parts.append(f'<g fill="none" stroke="{color}" stroke-opacity="{.48 if front else .22}" stroke-width=".8">')
    for p,q in sorted(edges):
        parts.append(f'<path d="M{point(p)} L{point(q)}"/>')
    parts.append('</g>')
    if front:
        parts.append('<path d="M'+' L'.join(map(point,ridge))+'" fill="none" stroke="#070917" stroke-width="5"/>')
    parts.append('<path d="M'+' L'.join(map(point,ridge))+f'" fill="none" stroke="{color}" stroke-opacity="{.95 if front else .55}" stroke-width="{1.6 if front else 1}"/>')
    # A broken ridge descending from the summit makes the elevation readable.
    peak = max(profile, key=lambda p:p[1])
    summit_point = (peak[0], BASE-height*peak[1])
    shoulder = (summit_point[0]*.55+foot[0]*.45,
                summit_point[1]*.55+foot[1]*.45)
    parts.append(f'<path d="M{point(summit_point)} L{point(shoulder)} L{point(foot)}" fill="none" stroke="{color}" stroke-opacity=".65" stroke-width="1.2"/>')
    nodes = [summit_point,shoulder] + interior[::2] + ridge[1:-1:2]
    for x,y in nodes:
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.5" fill="{color}" opacity=".08"/><circle cx="{x:.1f}" cy="{y:.1f}" r="1.2" fill="{color}" opacity=".8"/>')

# Taller outer mountains behind lower inward ridges; asymmetrical slopes on each side.
mountain(0,650,115,260,150,260)
mountain(840,1600,1460,226,290,140)
mountain(0,565,245,126,235,205,front=True)
mountain(990,1600,1340,170,215,300,front=True)
parts.append('</svg>')
svg=''.join(parts)
ET.fromstring(svg)
Path('landing/public/assets/horizon-mountains.svg').write_text(svg)
print(f'Validated four overlapping mountains with {connection_count} mesh connections.')
