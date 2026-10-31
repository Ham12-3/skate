from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlopen, Request
import json

ROOT=Path(__file__).resolve().parents[1]
PBR=ROOT/'public'/'assets'/'pbr'
HDR=ROOT/'public'/'assets'/'hdri'
PBR.mkdir(parents=True,exist_ok=True)
HDR.mkdir(parents=True,exist_ok=True)
SURFACES={
    'asphalt':'asphalt_02','concrete':'concrete_floor','wood_ramp':'plywood','brick':'red_brick_03',
    'metal_rail':'metal_plate','gravel':'gravel_floor','stone_plaza':'stone_floor','sand':'sand_01','grass':'grass_01',
}
SKIES={
    'level1':'kloppenheim_06','level2':'industrial_sunset','level3':'venice_sunset',
    'level4':'urban_street_01','level5':'sunflowers_puresky',
}

def json_url(url):
    with urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=30) as response:return json.load(response)

def download(url,path):
    if path.exists():return
    with urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=90) as response:path.write_bytes(response.read())

def surface(job):
    name,asset=job
    try:
        data=json_url(f'https://api.polyhaven.com/files/{asset}')
        downloaded=[]
        for channel,key in [('color','Diffuse'),('normal','nor_gl'),('roughness','Rough'),('ao','AO')]:
            if key not in data:continue
            formats=data[key].get('1k',{})
            if 'jpg' not in formats:continue
            path=PBR/f'{name}_{channel}.jpg'
            download(formats['jpg']['url'],path)
            downloaded.append(path.name)
        print(name,len(downloaded),'maps')
    except Exception as error:
        print(f'WARNING {name}: {error}')

def sky(job):
    name,asset=job
    try:
        data=json_url(f'https://api.polyhaven.com/files/{asset}')
        path=HDR/f'{name}.hdr'
        download(data['hdri']['2k']['hdr']['url'],path)
        print(name,path.stat().st_size)
    except Exception as error:
        print(f'WARNING {name}: {error}')

with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(surface,SURFACES.items()))
    list(pool.map(sky,SKIES.items()))
