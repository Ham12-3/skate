# Motion capture from your own videos (free, on this PC)

Film a real skater on a phone and turn the video into a skater animation clip with Google's MediaPipe body
tracking, running locally: no account, no upload, no cost. Each clip replaces the procedural motion for one
skater state. The game still plants the feet on the deck, moves the board and leans the rider into carves,
so the clips only need to capture the body.

## Make a clip

From the project root, one command does everything:

```bash
tools\mocap\.venv\Scripts\python.exe tools/mocap/video_to_clip.py path\to\video.mp4 push
```

The last word is the clip name, which is the skater state it drives (see the shot list). The tool tracks the
person, smooths the motion, writes `tools/mocap/incoming/push.bvh`, then runs Blender to fit every clip in
that folder onto the skater, producing `public/assets/mocap/skater_mocap.glb`. Reload the game to see it.

Useful options:

| Option | What it does |
|---|---|
| `--start 1.5 --end 4` | Use only seconds 1.5 to 4 of the video (trim to the move itself) |
| `--smooth 3` | Steadier, softer motion (default 2; 0 turns smoothing off) |
| `--rotate 90` | Rotate frames if a phone video comes out sideways |
| `--no-retarget` | Only write the BVH, skip Blender |

To go back to procedural motion, delete `public/assets/mocap/skater_mocap.glb`. To drop one clip, delete its
`.bvh` from `incoming/` and run any clip again (Blender re-fits everything in the folder).

## Filming

- Phone on a tripod (or propped up), **not moving**. Landscape is easiest.
- The **whole body in frame the entire time**, head to feet, with space around.
- Good, even daylight. Fitted clothes track better than baggy hoodies.
- One person in frame. 30 or 60 fps.
- One move per clip. For looping clips, start and end in roughly the same pose.

The skater can ride slowly across the frame, or stand on a board on grass or carpet so it can't roll away.
Either works: only the body is captured.

## Shot list

| Clip name | What to film | Loops? |
|---|---|---|
| `idle` | Standing on the board, relaxed, shifting weight, looking around | yes |
| `roll` | Cruising stance, small balance adjustments, looking ahead | yes |
| `push` | One push stroke: back foot off, push, back on the tail (trim to a single stroke) | yes, synced to each push |
| `crouch` | Winding up for an ollie and holding the crouch | yes |
| `air` | A jump with knees tucked, arms out for balance | yes |
| `land` | Absorbing a landing, knees bending then rising | no |
| `grind` | Balancing with arms out, as on a ledge | yes |
| `grab` | Tucked with the back hand reaching down | yes |

Start with `idle`, `roll` and `push`: they are on screen most of the time.

## What to expect

Single-camera tracking guesses depth, so a limb that points toward or away from the camera can be off by
10-15 degrees, and quick moves can jitter. Film side-on or at 45 degrees rather than straight at the camera,
keep the light good, and raise `--smooth` if a clip looks shaky.

## Setup (already done on this PC)

The tool lives in `tools/mocap/`: `.venv/` is its own Python 3.12 environment (MediaPipe, OpenCV, NumPy),
and `models/pose_landmarker_heavy.task` is Google's pose model. To recreate them elsewhere:

```bash
py -3.12 -m venv tools\mocap\.venv
tools\mocap\.venv\Scripts\python.exe -m pip install mediapipe opencv-python numpy
```

and download the model from
`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task`
into `tools/mocap/models/`. Blender (any recent version under `C:\Program Files\Blender Foundation`) is found
automatically; otherwise pass `--blender "path\to\blender.exe"`.

## Other sources

`tools/blender/retarget_mocap.py` also accepts FBX/BVH from anywhere else: Rokoko Vision's free tier, Mixamo,
the CMU motion capture library, or FreeMoCap. Name the file after the state, put it in `incoming/`, and run:

```bash
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --python tools/blender/retarget_mocap.py -- tools/mocap/incoming
```
