#!/usr/bin/env python3
"""
face_tracker.py - Detects faces and identifies the active speaker using MediaPipe FaceLandmarker.
Uses the new Tasks API (mediapipe >= 0.10).
Usage: python3 face_tracker.py <video_path> <output_json_path>
"""

import sys
import json
import os
import urllib.request
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import numpy as np

SAMPLE_FPS = 3
MOUTH_OPEN_THRESHOLD = 0.15   # jawOpen blendshape score threshold
WINDOW_SECS = 1.5

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'face_landmarker.task')
MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

# Mouth landmark indices for MAR fallback (same as old API)
MOUTH_LEFT = 61
MOUTH_RIGHT = 291
MOUTH_TOP = 13
MOUTH_BOTTOM = 14


def ensure_model():
    if not os.path.exists(MODEL_PATH):
        print('[face_tracker] Downloading face_landmarker.task model...', file=sys.stderr)
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        print('[face_tracker] Model downloaded.', file=sys.stderr)


def compute_mar(landmarks, img_w, img_h):
    def pt(idx):
        lm = landmarks[idx]
        return np.array([lm.x * img_w, lm.y * img_h])
    top = pt(MOUTH_TOP)
    bottom = pt(MOUTH_BOTTOM)
    left = pt(MOUTH_LEFT)
    right = pt(MOUTH_RIGHT)
    vertical = np.linalg.norm(bottom - top)
    horizontal = np.linalg.norm(right - left)
    if horizontal < 1e-6:
        return 0.0
    return float(vertical / horizontal)


def iou(a, b):
    ax1, ay1 = a[0], a[1]
    ax2, ay2 = a[0] + a[2], a[1] + a[3]
    bx1, by1 = b[0], b[1]
    bx2, by2 = b[0] + b[2], b[1] + b[3]
    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    inter_area = max(0, inter_x2 - inter_x1) * max(0, inter_y2 - inter_y1)
    union_area = (a[2] * a[3]) + (b[2] * b[3]) - inter_area
    return inter_area / union_area if union_area > 0 else 0.0


def track_faces(current_faces, prev_faces, next_id):
    assigned = {}
    used_prev = set()
    for i, (bbox, _) in enumerate(current_faces):
        best_iou = 0.3
        best_j = None
        for j, (pbbox, _) in enumerate(prev_faces):
            if j in used_prev:
                continue
            score = iou(bbox, pbbox)
            if score > best_iou:
                best_iou = score
                best_j = j
        if best_j is not None:
            assigned[i] = best_j
            used_prev.add(best_j)
    current_ids = {}
    for i in range(len(current_faces)):
        if i in assigned:
            current_ids[i] = assigned[i]
        else:
            current_ids[i] = next_id
            next_id += 1
    return current_ids, next_id


def main():
    if len(sys.argv) != 3:
        print('Usage: face_tracker.py <video_path> <output_json_path>', file=sys.stderr)
        sys.exit(1)

    video_path = sys.argv[1]
    output_path = sys.argv[2]

    ensure_model()

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f'Cannot open video: {video_path}', file=sys.stderr)
        sys.exit(1)

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    img_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    img_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_step = max(1, int(video_fps / SAMPLE_FPS))

    base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
    options = mp_vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_faces=4,
        min_face_detection_confidence=0.4,
        min_face_presence_confidence=0.4,
        min_tracking_confidence=0.4,
        output_face_blendshapes=True,
    )
    landmarker = mp_vision.FaceLandmarker.create_from_options(options)

    frames_data = []
    prev_faces_raw = []
    next_id = 0
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_step != 0:
            frame_idx += 1
            continue

        timestamp = frame_idx / video_fps
        timestamp_ms = int(timestamp * 1000)

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect_for_video(mp_image, timestamp_ms)

        current_faces_raw = []
        if result.face_landmarks:
            for i, face_lms in enumerate(result.face_landmarks):
                xs = [lm.x * img_w for lm in face_lms]
                ys = [lm.y * img_h for lm in face_lms]
                x1, y1 = max(0, int(min(xs))), max(0, int(min(ys)))
                x2, y2 = min(img_w, int(max(xs))), min(img_h, int(max(ys)))
                bbox = (x1, y1, x2 - x1, y2 - y1)

                # Prefer blendshape jawOpen for speaking detection
                mouth_open = False
                if result.face_blendshapes and i < len(result.face_blendshapes):
                    for bs in result.face_blendshapes[i]:
                        if bs.category_name == 'jawOpen':
                            mouth_open = bs.score > MOUTH_OPEN_THRESHOLD
                            break
                else:
                    mar = compute_mar(face_lms, img_w, img_h)
                    mouth_open = mar > 0.04

                current_faces_raw.append((bbox, mouth_open))

        current_id_map, next_id = track_faces(current_faces_raw, prev_faces_raw, next_id)

        face_list = []
        for i, (bbox, speaking) in enumerate(current_faces_raw):
            face_id = current_id_map.get(i, next_id - 1)
            face_list.append({
                'id': face_id,
                'x': bbox[0],
                'y': bbox[1],
                'w': bbox[2],
                'h': bbox[3],
                'speaking': speaking,
            })

        frames_data.append({
            'time': round(timestamp, 3),
            'faces': face_list,
            'active_speaker_id': None,
        })

        prev_faces_raw = current_faces_raw
        frame_idx += 1

    cap.release()
    landmarker.close()

    # Post-processing: determine active speaker per frame
    window_frames = max(1, int(WINDOW_SECS * SAMPLE_FPS))
    for i, frame_data in enumerate(frames_data):
        start = max(0, i - window_frames // 2)
        end = min(len(frames_data), i + window_frames // 2 + 1)
        speaking_count = {}
        for j in range(start, end):
            for face in frames_data[j]['faces']:
                if face['speaking']:
                    fid = face['id']
                    speaking_count[fid] = speaking_count.get(fid, 0) + 1
        if speaking_count:
            frame_data['active_speaker_id'] = max(speaking_count, key=speaking_count.get)
        elif frame_data['faces']:
            def centrality(f):
                cx = f['x'] + f['w'] / 2
                return -abs(cx - img_w / 2)
            frame_data['active_speaker_id'] = max(frame_data['faces'], key=centrality)['id']

    output = {
        'width': img_w,
        'height': img_h,
        'fps': video_fps,
        'sample_fps': SAMPLE_FPS,
        'frames': frames_data,
    }

    with open(output_path, 'w') as f:
        json.dump(output, f)

    print(f'[face_tracker] Processed {len(frames_data)} frames, {img_w}x{img_h} @ {video_fps:.1f}fps', file=sys.stderr)


if __name__ == '__main__':
    main()
