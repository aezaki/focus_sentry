import cv2
import numpy as np

# Face and eye detectors
_face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)

_eye_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_eye_tree_eyeglasses.xml"
)


def classify_focus_state(image_bytes: bytes) -> bool:
    """
    Heuristic using OpenCV Haar cascades.

    Focused if:
    - a face is detected and
    - at least one eye is detected in the upper part of the face and
    - the face center is roughly near the center of the frame

    Otherwise treat as not focused.
    """
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img is None:
        return False

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    faces = _face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.3,
        minNeighbors=5,
        minSize=(60, 60),
    )

    if len(faces) == 0:
        # no face at all
        return False

    # take largest face
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    face_cx = x + w / 2.0
    face_cy = y + h / 2.0

    img_h, img_w = gray.shape

    # Require face center in a central region of the frame
    cx_min = img_w * 0.3
    cx_max = img_w * 0.7
    cy_min = img_h * 0.2
    cy_max = img_h * 0.8
    in_center = cx_min <= face_cx <= cx_max and cy_min <= face_cy <= cy_max
    if not in_center:
        return False

    # Look for eyes in the upper part of the face
    face_roi_gray = gray[y : y + h, x : x + w]

    # only the upper ~60 percent of face, where eyes should be
    upper_h = int(h * 0.6)
    upper_face_gray = face_roi_gray[0:upper_h, :]

    eyes = _eye_cascade.detectMultiScale(
        upper_face_gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(15, 15),
    )

    if len(eyes) == 0:
        # face found but no eyes detected, treat as eyes closed or looking away
        return False

    # if we got here, face is centered and eyes are visible
    return True
